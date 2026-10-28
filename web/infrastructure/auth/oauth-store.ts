/**
 * Every statement the MCP connector's authorization server makes: clients that
 * registered themselves, consent pages waiting for an answer, grants, and the
 * tokens issued under them.
 *
 * Nothing here stores a credential a client holds. Codes, access tokens,
 * refresh tokens and consent tokens arrive as SHA-256 digests, made by the
 * caller, for the reason `session` keys on one.
 *
 * Every "use this once" question is answered by one statement that both checks
 * and spends (`UPDATE ... RETURNING`, `DELETE ... RETURNING`), so two requests
 * carrying the same code or the same refresh token cannot both be answered.
 */

import { and, desc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { oauthClient, oauthConsent, oauthGrant, oauthToken, user } from '../db/schema'

/** How long an access token lives. */
export const ACCESS_TOKEN_MINUTES = 60

/** How long a refresh token lives from its issue, matching a session's thirty days. */
export const REFRESH_TOKEN_DAYS = 30

/** How long an authorization code may wait to be exchanged. */
export const CODE_MINUTES = 5

/** How long a consent page may wait for an answer. */
export const CONSENT_MINUTES = 10

const at = (when: Date): string => when.toISOString()

function later(when: Date, minutes: number): string {
  return at(new Date(when.getTime() + minutes * 60_000))
}

export interface ConsentRow {
  user_id: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  state: string
  resource: string
}

export interface GrantRow {
  id: string
  client_id: string
  user_id: string
  resource: string
  redirect_uri: string
  code_challenge: string
}

/**
 * What `/mcp` asks about a bearer token, in one row. `enabled` is read from
 * `user` here on every request, exactly as the gate reads it for a session.
 */
export interface LiveAccess {
  grant_id: string
  client_id: string
  user_id: string
  resource: string
  expires_at: string
  enabled: boolean
}

export interface ConnectionRow {
  id: string
  client_id: string
  metadata: string
  redirect_uri: string
  created_at: string
  last_used_at: string
}

/** A code or refresh token presented a second time: the grant has been revoked. */
export const REPLAYED = 'replayed' as const

const grantColumns = {
  id: oauthGrant.id,
  clientId: oauthGrant.clientId,
  userId: oauthGrant.userId,
  resource: oauthGrant.resource,
  redirectUri: oauthGrant.redirectUri,
  codeChallenge: oauthGrant.codeChallenge,
}

export class OAuthStore {
  constructor(private readonly db: Db) {}

  async registerClient(clientId: string, metadata: string, now: Date): Promise<void> {
    const insert = statement(
      build.insert(oauthClient).values({ clientId, metadata, createdAt: at(now) }),
    )
    await this.db.run(insert.text, insert.values)
  }

  /** The registration response as it was stored, or undefined for a client nobody registered. */
  async clientMetadata(clientId: string): Promise<string | undefined> {
    const query = statement(
      build.select({ metadata: oauthClient.metadata }).from(oauthClient)
        .where(eq(oauthClient.clientId, clientId)),
    )
    return (await this.db.get<{ metadata: string }>(query.text, query.values))?.metadata
  }

  async openConsent(
    consent: {
      tokenHash: string
      sessionHash: string
      userId: string
      clientId: string
      redirectUri: string
      codeChallenge: string
      state: string
      resource: string
    },
    now: Date,
  ): Promise<void> {
    const insert = statement(
      build.insert(oauthConsent).values({
        ...consent,
        createdAt: at(now),
        expiresAt: later(now, CONSENT_MINUTES),
      }),
    )
    await this.db.run(insert.text, insert.values)
  }

  /**
   * Take an answered consent page, once, and only from the session it was
   * shown to. A token posted from another session, or a second time, or late,
   * answers undefined, and the row is gone either way: a consent token that
   * has been posted from the wrong session has been seen by somebody else.
   */
  async takeConsent(tokenHash: string, sessionHash: string, now: Date): Promise<ConsentRow | undefined> {
    const sweep = statement(build.delete(oauthConsent).where(lt(oauthConsent.expiresAt, at(now))))
    await this.db.run(sweep.text, sweep.values)

    const take = statement(
      build.delete(oauthConsent)
        .where(and(
          eq(oauthConsent.tokenHash, tokenHash),
          gt(oauthConsent.expiresAt, at(now)),
        ))
        .returning({
          sessionHash: oauthConsent.sessionHash,
          userId: oauthConsent.userId,
          clientId: oauthConsent.clientId,
          redirectUri: oauthConsent.redirectUri,
          codeChallenge: oauthConsent.codeChallenge,
          state: oauthConsent.state,
          resource: oauthConsent.resource,
        }),
    )
    const taken = await this.db.get<ConsentRow & { session_hash: string }>(take.text, take.values)
    if (!taken || taken.session_hash !== sessionHash) return undefined
    return taken
  }

  /** A person approved a client: the grant, with its one authorization code. */
  async openGrant(
    grant: {
      id: string
      clientId: string
      userId: string
      resource: string
      redirectUri: string
      codeHash: string
      codeChallenge: string
    },
    now: Date,
  ): Promise<void> {
    const insert = statement(
      build.insert(oauthGrant).values({
        ...grant,
        codeExpiresAt: later(now, CODE_MINUTES),
        createdAt: at(now),
        lastUsedAt: at(now),
      }),
    )
    await this.db.run(insert.text, insert.values)
  }

  /**
   * The PKCE challenge a code was issued against, if the code is one this
   * client may still exchange. Read before the code is spent, because the SDK
   * checks the verifier between the two.
   */
  async challengeFor(codeHash: string, clientId: string, now: Date): Promise<string | undefined> {
    const query = statement(
      build.select({ codeChallenge: oauthGrant.codeChallenge }).from(oauthGrant)
        .where(and(
          eq(oauthGrant.codeHash, codeHash),
          eq(oauthGrant.clientId, clientId),
          isNull(oauthGrant.codeUsedAt),
          isNull(oauthGrant.revokedAt),
          gt(oauthGrant.codeExpiresAt, at(now)),
        )),
    )
    return (await this.db.get<{ code_challenge: string }>(query.text, query.values))?.code_challenge
  }

  /**
   * Spend a code, once. A code that was already spent is a replay, and the
   * grant it opened is revoked along with every token issued under it, since
   * one of the two parties presenting it is not the client.
   */
  async spendCode(codeHash: string, clientId: string, now: Date): Promise<GrantRow | typeof REPLAYED | undefined> {
    const spend = statement(
      build.update(oauthGrant)
        .set({ codeUsedAt: at(now), lastUsedAt: at(now) })
        .where(and(
          eq(oauthGrant.codeHash, codeHash),
          eq(oauthGrant.clientId, clientId),
          isNull(oauthGrant.codeUsedAt),
          isNull(oauthGrant.revokedAt),
          gt(oauthGrant.codeExpiresAt, at(now)),
        ))
        .returning(grantColumns),
    )
    const spent = await this.db.get<GrantRow>(spend.text, spend.values)
    if (spent) return spent

    const revoke = statement(
      build.update(oauthGrant)
        .set({ revokedAt: at(now) })
        .where(and(
          eq(oauthGrant.codeHash, codeHash),
          isNotNull(oauthGrant.codeUsedAt),
          isNull(oauthGrant.revokedAt),
        )),
    )
    return (await this.db.run(revoke.text, revoke.values)).changes > 0 ? REPLAYED : undefined
  }

  async issueTokens(grantId: string, accessHash: string, refreshHash: string, now: Date): Promise<void> {
    const insert = statement(
      build.insert(oauthToken).values([
        { tokenHash: accessHash, grantId, kind: 'access', createdAt: at(now), expiresAt: later(now, ACCESS_TOKEN_MINUTES) },
        { tokenHash: refreshHash, grantId, kind: 'refresh', createdAt: at(now), expiresAt: later(now, REFRESH_TOKEN_DAYS * 24 * 60) },
      ]),
    )
    await this.db.run(insert.text, insert.values)
  }

  /**
   * Spend a refresh token, once, for the grant it belongs to. A refresh token
   * presented after it was spent is a replay, and revokes the grant.
   */
  async spendRefresh(refreshHash: string, clientId: string, now: Date): Promise<GrantRow | typeof REPLAYED | undefined> {
    const spend = statement(sql`
      update ${oauthToken}
         set ${sql.identifier(oauthToken.revokedAt.name)} = ${at(now)}
        from ${oauthGrant}
       where ${oauthToken.tokenHash} = ${refreshHash}
         and ${oauthToken.kind} = 'refresh'
         and ${oauthToken.revokedAt} is null
         and ${oauthToken.expiresAt} > ${at(now)}
         and ${oauthGrant.id} = ${oauthToken.grantId}
         and ${oauthGrant.clientId} = ${clientId}
         and ${oauthGrant.revokedAt} is null
      returning ${oauthGrant.id}, ${oauthGrant.clientId}, ${oauthGrant.userId},
                ${oauthGrant.resource}, ${oauthGrant.redirectUri}, ${oauthGrant.codeChallenge}
    `)
    const spent = await this.db.get<GrantRow>(spend.text, spend.values)
    if (spent) {
      const touch = statement(
        build.update(oauthGrant).set({ lastUsedAt: at(now) }).where(eq(oauthGrant.id, spent.id)),
      )
      await this.db.run(touch.text, touch.values)
      return spent
    }

    const revoke = statement(sql`
      update ${oauthGrant}
         set ${sql.identifier(oauthGrant.revokedAt.name)} = ${at(now)}
        from ${oauthToken}
       where ${oauthToken.tokenHash} = ${refreshHash}
         and ${oauthToken.kind} = 'refresh'
         and ${oauthToken.revokedAt} is not null
         and ${oauthGrant.id} = ${oauthToken.grantId}
         and ${oauthGrant.revokedAt} is null
    `)
    return (await this.db.run(revoke.text, revoke.values)).changes > 0 ? REPLAYED : undefined
  }

  /**
   * The one question `/mcp` asks, in one round trip. An access token is live
   * when it exists, has not expired, and its grant has not been revoked.
   */
  async liveAccess(accessHash: string, now: Date): Promise<LiveAccess | undefined> {
    const query = statement(
      build.select({
        grantId: oauthGrant.id,
        clientId: oauthGrant.clientId,
        userId: oauthGrant.userId,
        resource: oauthGrant.resource,
        expiresAt: oauthToken.expiresAt,
        enabled: user.enabled,
      })
        .from(oauthToken)
        .innerJoin(oauthGrant, eq(oauthToken.grantId, oauthGrant.id))
        .innerJoin(user, eq(oauthGrant.userId, user.id))
        .where(and(
          eq(oauthToken.tokenHash, accessHash),
          eq(oauthToken.kind, 'access'),
          isNull(oauthToken.revokedAt),
          gt(oauthToken.expiresAt, at(now)),
          isNull(oauthGrant.revokedAt),
        )),
    )
    const row = await this.db.get<{
      id: string; client_id: string; user_id: string; resource: string; expires_at: string; enabled: boolean
    }>(query.text, query.values)
    if (!row) return undefined
    return {
      grant_id: row.id,
      client_id: row.client_id,
      user_id: row.user_id,
      resource: row.resource,
      expires_at: row.expires_at,
      enabled: row.enabled,
    }
  }

  /**
   * RFC 7009. Revoking either token ends the grant it was issued under, so a
   * client that disconnects is disconnected rather than left holding the other
   * half. A token this client was not issued is ignored, as the RFC asks.
   */
  async revokeByToken(tokenHash: string, clientId: string, now: Date): Promise<void> {
    const revoke = statement(sql`
      update ${oauthGrant}
         set ${sql.identifier(oauthGrant.revokedAt.name)} = ${at(now)}
        from ${oauthToken}
       where ${oauthToken.tokenHash} = ${tokenHash}
         and ${oauthGrant.id} = ${oauthToken.grantId}
         and ${oauthGrant.clientId} = ${clientId}
         and ${oauthGrant.revokedAt} is null
    `)
    await this.db.run(revoke.text, revoke.values)
  }

  /**
   * Delete every registration made before `before` that no person has ever
   * approved, and answer how many went. A grant keeps its client even once
   * revoked, because the grant is the record of a connection somebody made. A
   * consent page still waiting for an answer keeps its client too, so a person
   * reading one when the sweep runs is not answered "expired" for it.
   */
  async sweepUnclaimedClients(before: Date, now: Date): Promise<number> {
    const sweep = statement(sql`
      delete from ${oauthClient}
       where ${oauthClient.createdAt} < ${at(before)}
         and not exists (select 1 from ${oauthGrant} where ${oauthGrant.clientId} = ${oauthClient.clientId})
         and not exists (
           select 1 from ${oauthConsent}
            where ${oauthConsent.clientId} = ${oauthClient.clientId}
              and ${oauthConsent.expiresAt} > ${at(now)})
    `)
    return (await this.db.run(sweep.text, sweep.values)).changes
  }

  /** A person disconnecting one of their own clients. False when it was not theirs or is already gone. */
  async revokeGrant(grantId: string, userId: string, now: Date): Promise<boolean> {
    const query = statement(
      build.update(oauthGrant)
        .set({ revokedAt: at(now) })
        .where(and(eq(oauthGrant.id, grantId), eq(oauthGrant.userId, userId), isNull(oauthGrant.revokedAt))),
    )
    return (await this.db.run(query.text, query.values)).changes > 0
  }

  /**
   * The clients a person has connected and not disconnected, newest first. A
   * grant whose code was never exchanged is not a connection yet.
   */
  async connections(userId: string): Promise<ConnectionRow[]> {
    const query = statement(
      build.select({
        id: oauthGrant.id,
        clientId: oauthGrant.clientId,
        metadata: oauthClient.metadata,
        redirectUri: oauthGrant.redirectUri,
        createdAt: oauthGrant.createdAt,
        lastUsedAt: oauthGrant.lastUsedAt,
      })
        .from(oauthGrant)
        .innerJoin(oauthClient, eq(oauthGrant.clientId, oauthClient.clientId))
        .where(and(
          eq(oauthGrant.userId, userId),
          isNull(oauthGrant.revokedAt),
          isNotNull(oauthGrant.codeUsedAt),
        ))
        .orderBy(desc(oauthGrant.createdAt)),
    )
    return this.db.all<ConnectionRow>(query.text, query.values)
  }
}
