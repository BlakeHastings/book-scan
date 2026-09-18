/**
 * Every statement the gate and the sign-in make, in the layer that owns
 * statements. The SQL is generated from `infrastructure/db/schema.ts` through
 * `infrastructure/db/query.ts`, so a renamed column is a compile error here;
 * `Db` owns the connection and the transaction, and Drizzle never sees one.
 * One class rather than four repositories, because the four tables are one
 * subject the gate reads across in a single question.
 *
 * Deliberately: never looks anybody up by email, since two providers can
 * assert the same address about different people; never links a second
 * identity to an existing user, `findOrCreate` always creates a new user for
 * an unknown `(issuer, subject)`; holds no notion of a role beyond `enabled`.
 */

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm'

import { SIGN_IN_FLOW_MINUTES } from '../../shared/auth'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { session, signInFlow, user, userIdentity } from '../db/schema'

/** How long a session lives from its last use. See `schema.ts` on `session`. */
export const SESSION_DAYS = 30

/**
 * How stale a session may get before a use writes to it. Renewal on every
 * request would mean a write per request; an hour keeps the window sliding
 * without making the gate a writer.
 */
export const RENEW_AFTER_MINUTES = 60

/**
 * How long a half-finished sign-in is allowed to sit unfinished. The number
 * lives in `shared/auth.ts` because the flow cookie's `Max-Age` and a
 * sentence on the login screen have to say the same thing.
 */
export const FLOW_MINUTES = SIGN_IN_FLOW_MINUTES

/** ISO 8601, UTC, which is how every `_at` column in this schema is spelled. */
const at = (when: Date): string => when.toISOString()

/** `when`, plus some minutes, as this schema spells a moment. */
function later(when: Date, minutes: number): string {
  return at(new Date(when.getTime() + minutes * 60_000))
}

export interface UserRow {
  id: string
  enabled: boolean
  created_at: string
  enabled_at: string | null
}

export interface IdentityRow {
  issuer: string
  subject: string
  user_id: string
  email: string
  name: string
  first_seen_at: string
  last_seen_at: string
}

/**
 * What the gate asks for, in one row rather than two. `enabled` is read from
 * `user` on every request rather than copied onto the session, so disabling
 * somebody takes effect on their next request instead of at session expiry.
 */
export interface LiveSession {
  token_hash: string
  user_id: string
  last_used_at: string
  expires_at: string
  enabled: boolean
}

export interface FlowRow {
  state: string
  provider: string
  code_verifier: string
  nonce: string
  next: string
}

export interface UserWithIdentities extends UserRow {
  identities: IdentityRow[]
}

export class AuthStore {
  constructor(private readonly db: Db) {}

  /**
   * The one question the gate asks, answered in one round trip. A session is
   * live when it exists, has not been revoked and has not expired; a revoked
   * or expired row answers the same as no row: anonymous, and a `401`.
   *
   * Nothing about the person beyond `enabled` is read here, because this
   * runs on every request the app answers. Email and name are wanted by
   * exactly one route, `GET /api/auth/session`, which asks `latestIdentity`
   * instead.
   */
  async liveSession(tokenHash: string, now: Date): Promise<LiveSession | undefined> {
    const query = statement(
      build.select({
        tokenHash: session.tokenHash,
        userId: session.userId,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.expiresAt,
        enabled: user.enabled,
      })
        .from(session)
        .innerJoin(user, eq(session.userId, user.id))
        .where(and(
          eq(session.tokenHash, tokenHash),
          isNull(session.revokedAt),
          sql`${session.expiresAt} > ${at(now)}`,
        )),
    )
    return this.db.get<LiveSession>(query.text, query.values)
  }

  /**
   * The identity this person most recently signed in with. Absent only for a
   * user with no identity at all, which nothing here creates.
   */
  async latestIdentity(userId: string): Promise<IdentityRow | undefined> {
    const query = statement(
      build.select().from(userIdentity)
        .where(eq(userIdentity.userId, userId))
        .orderBy(desc(userIdentity.lastSeenAt))
        .limit(1),
    )
    return this.db.get<IdentityRow>(query.text, query.values)
  }

  /**
   * Start a session for a person who has just proved who they are. Takes the
   * hash, never the token: the caller mints the random value and hands it to
   * exactly one browser.
   */
  async openSession(tokenHash: string, userId: string, now: Date): Promise<void> {
    const insert = statement(sql`
      insert into ${session} (
        ${sql.identifier(session.tokenHash.name)},
        ${sql.identifier(session.userId.name)},
        ${sql.identifier(session.createdAt.name)},
        ${sql.identifier(session.lastUsedAt.name)},
        ${sql.identifier(session.expiresAt.name)}
      ) values (
        ${tokenHash}, ${userId}, ${at(now)}, ${at(now)},
        ${later(now, SESSION_DAYS * 24 * 60)}
      )
    `)
    await this.db.run(insert.text, insert.values)
  }

  /**
   * Push a session's window forward, and only when it has gone stale. The
   * `last_used_at` condition is in the statement rather than in the caller
   * so two requests arriving together cannot both decide to write.
   */
  async renewSession(tokenHash: string, now: Date): Promise<void> {
    const query = statement(
      build.update(session)
        .set({
          lastUsedAt: at(now),
          expiresAt: later(now, SESSION_DAYS * 24 * 60),
        })
        .where(and(
          eq(session.tokenHash, tokenHash),
          lt(session.lastUsedAt, later(now, -RENEW_AFTER_MINUTES)),
        )),
    )
    await this.db.run(query.text, query.values)
  }

  /** End one session. A sign-out, and what the caller's own cookie addresses. */
  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    const query = statement(
      build.update(session)
        .set({ revokedAt: at(now) })
        .where(and(eq(session.tokenHash, tokenHash), isNull(session.revokedAt))),
    )
    await this.db.run(query.text, query.values)
  }

  /** End every session one person holds. For the enable script's `--sign-out`. */
  async revokeSessionsFor(userId: string, now: Date): Promise<number> {
    const query = statement(
      build.update(session)
        .set({ revokedAt: at(now) })
        .where(and(eq(session.userId, userId), isNull(session.revokedAt))),
    )
    return (await this.db.run(query.text, query.values)).changes
  }

  /**
   * The person behind an external identity, creating them if this pair has
   * never been seen. `enabled` is left off the insert so the schema's default
   * applies, rather than being written here as `false`.
   *
   * `email` and `name` are refreshed on every sign-in because the provider is
   * the authority on both, and `last_seen_at` moves with them.
   */
  async findOrCreate(
    identity: { issuer: string; subject: string; email: string; name: string },
    now: Date,
  ): Promise<UserRow> {
    return this.db.tx(async (tx) => {
      const store = new AuthStore(tx)
      const found = await store.identity(identity.issuer, identity.subject)
      if (found) {
        await store.rememberIdentity(identity, found.user_id, now)
        const known = await store.byId(found.user_id)
        // A foreign key with `ON DELETE CASCADE` stands between these two rows,
        // so an identity whose user has gone is not a state this can reach.
        if (!known) throw new Error(`identity ${identity.issuer} names a user that is not there`)
        return known
      }

      const id = randomUUID()
      const insertUser = statement(sql`
        insert into ${user} (
          ${sql.identifier(user.id.name)},
          ${sql.identifier(user.createdAt.name)}
        ) values (${id}, ${at(now)})
      `)
      await tx.run(insertUser.text, insertUser.values)
      await store.rememberIdentity(identity, id, now)

      const made = await store.byId(id)
      if (!made) throw new Error('the user row that was just written is not there')
      return made
    })
  }

  /** Write, or refresh, what a provider says about somebody. */
  private async rememberIdentity(
    identity: { issuer: string; subject: string; email: string; name: string },
    userId: string,
    now: Date,
  ): Promise<void> {
    const insert = statement(sql`
      insert into ${userIdentity} (
        ${sql.identifier(userIdentity.issuer.name)},
        ${sql.identifier(userIdentity.subject.name)},
        ${sql.identifier(userIdentity.userId.name)},
        ${sql.identifier(userIdentity.email.name)},
        ${sql.identifier(userIdentity.name.name)},
        ${sql.identifier(userIdentity.firstSeenAt.name)},
        ${sql.identifier(userIdentity.lastSeenAt.name)}
      ) values (
        ${identity.issuer}, ${identity.subject}, ${userId},
        ${identity.email}, ${identity.name}, ${at(now)}, ${at(now)}
      )
      on conflict (
        ${sql.identifier(userIdentity.issuer.name)},
        ${sql.identifier(userIdentity.subject.name)}
      ) do update set
        ${sql.identifier(userIdentity.email.name)} = excluded.${sql.identifier(userIdentity.email.name)},
        ${sql.identifier(userIdentity.name.name)} = excluded.${sql.identifier(userIdentity.name.name)},
        ${sql.identifier(userIdentity.lastSeenAt.name)} = ${at(now)}
    `)
    await this.db.run(insert.text, insert.values)
  }

  async byId(id: string): Promise<UserRow | undefined> {
    const query = statement(build.select().from(user).where(eq(user.id, id)))
    return this.db.get<UserRow>(query.text, query.values)
  }

  async identity(issuer: string, subject: string): Promise<IdentityRow | undefined> {
    const query = statement(
      build.select().from(userIdentity)
        .where(and(eq(userIdentity.issuer, issuer), eq(userIdentity.subject, subject))),
    )
    return this.db.get<IdentityRow>(query.text, query.values)
  }

  /**
   * Everybody, newest first, with the identities each holds. Two queries
   * rather than a join, because a join would return one row per identity and
   * the caller would have to fold them into the nested shape wanted.
   */
  async everybody(): Promise<UserWithIdentities[]> {
    const people = statement(build.select().from(user).orderBy(desc(user.createdAt)))
    const rows = await this.db.all<UserRow>(people.text, people.values)

    const identities = statement(
      build.select().from(userIdentity)
        .orderBy(asc(userIdentity.userId), asc(userIdentity.firstSeenAt)),
    )
    const held = await this.db.all<IdentityRow>(identities.text, identities.values)

    return rows.map((person) => ({
      ...person,
      identities: held.filter((one) => one.user_id === person.id),
    }))
  }

  /**
   * The people an exact email address names, which may be none and may be
   * several. Several is not resolved here; picking one would be deciding
   * that an address identifies a person, which this store does not do.
   */
  async byEmail(email: string): Promise<UserWithIdentities[]> {
    const everyone = await this.everybody()
    const wanted = email.trim().toLowerCase()
    return everyone.filter((person) =>
      person.identities.some((one) => one.email.trim().toLowerCase() === wanted))
  }

  /**
   * Let somebody in, or stop letting them in. `enabled_at` records when the
   * door was opened and is cleared when it is shut.
   *
   * Disabling does not touch their sessions on purpose: the gate reads
   * `enabled` on every request, so the next one answers `403`. A separate
   * revocation sweep exists for "throw away the credential" instead.
   *
   * Returns whether anything changed, so the script can say "already
   * enabled" rather than claiming to have done something.
   */
  async setEnabled(id: string, enabled: boolean, now: Date): Promise<boolean> {
    const query = statement(
      build.update(user)
        .set({ enabled, enabledAt: enabled ? at(now) : null })
        .where(and(eq(user.id, id), eq(user.enabled, !enabled))),
    )
    return (await this.db.run(query.text, query.values)).changes > 0
  }

  /** Remember a sign-in that has been sent to a provider and not come back. */
  async openFlow(
    flow: { state: string; provider: string; codeVerifier: string; nonce: string; next: string },
    now: Date,
  ): Promise<void> {
    const insert = statement(sql`
      insert into ${signInFlow} (
        ${sql.identifier(signInFlow.state.name)},
        ${sql.identifier(signInFlow.provider.name)},
        ${sql.identifier(signInFlow.codeVerifier.name)},
        ${sql.identifier(signInFlow.nonce.name)},
        ${sql.identifier(signInFlow.next.name)},
        ${sql.identifier(signInFlow.startedAt.name)},
        ${sql.identifier(signInFlow.expiresAt.name)}
      ) values (
        ${flow.state}, ${flow.provider}, ${flow.codeVerifier}, ${flow.nonce},
        ${flow.next}, ${at(now)}, ${later(now, FLOW_MINUTES)}
      )
    `)
    await this.db.run(insert.text, insert.values)
  }

  /**
   * Take a half-finished sign-in, once. `DELETE ... RETURNING` rather than a
   * select and a delete, so two callbacks carrying the same state cannot
   * both be answered: only the one statement that removes the row gets it
   * back.
   */
  async takeFlow(state: string, now: Date): Promise<FlowRow | undefined> {
    const sweep = statement(
      build.delete(signInFlow).where(lt(signInFlow.expiresAt, at(now))),
    )
    await this.db.run(sweep.text, sweep.values)

    const take = statement(sql`
      delete from ${signInFlow}
       where ${signInFlow.state} = ${state}
         and ${signInFlow.expiresAt} > ${at(now)}
      returning
        ${sql.identifier(signInFlow.state.name)},
        ${sql.identifier(signInFlow.provider.name)},
        ${sql.identifier(signInFlow.codeVerifier.name)},
        ${sql.identifier(signInFlow.nonce.name)},
        ${sql.identifier(signInFlow.next.name)}
    `)
    return this.db.get<FlowRow>(take.text, take.values)
  }
}
