/**
 * Every statement the gate and the sign-in make, in the layer that owns
 * statements (#521).
 *
 * Built the way #172 established and every slice since has followed: the SQL is
 * generated from `infrastructure/db/schema.ts` through `infrastructure/db/query.ts`,
 * so a column renamed in the schema is a compile error here rather than a
 * statement that fails on somebody's shelf, and `Db` still owns the connection
 * and the transaction. Drizzle never sees a connection.
 *
 * It is one class rather than four repositories because the four tables are one
 * subject and the gate reads across them in a single question. Splitting them
 * would mean a `SessionRepository` that has to join `user` to answer anything
 * useful, which is two objects sharing one query.
 *
 * ## What this deliberately does not do
 *
 * - **It never looks anybody up by email.** `emailOf` exists for the enable
 *   script's list and takes an exact address, and even that refuses an ambiguous
 *   answer rather than picking one. #510: two providers can assert the same
 *   address about different people, and treating that as one person is an
 *   account takeover.
 * - **It never links a second identity to an existing user.** `findOrCreate`
 *   creates a new user for an unknown `(issuer, subject)`, always. Linking is a
 *   deliberate act by somebody already signed in and is not in #521.
 * - **It holds no notion of a role.** There is nothing here to grant and
 *   nothing to check beyond `enabled`, on purpose: #171 has not decided roles.
 */

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm'

import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { session, signInFlow, user, userIdentity } from '../db/schema'

/** How long a session lives from its last use. See `schema.ts` on `session`. */
export const SESSION_DAYS = 30

/**
 * How stale a session may get before a use writes to it.
 *
 * Renewal on every request would mean a write per request, and an ordinary
 * screen makes half a dozen. An hour keeps a thirty day window sliding without
 * making the gate a writer.
 */
export const RENEW_AFTER_MINUTES = 60

/** How long a half-finished sign-in is allowed to sit unfinished. */
export const FLOW_MINUTES = 10

/** ISO 8601, UTC, which is how every `_at` column in this schema is spelled. */
const at = (when: Date): string => when.toISOString()

/** `when`, plus some minutes, as this schema spells a moment. */
function later(when: Date, minutes: number): string {
  return at(new Date(when.getTime() + minutes * 60_000))
}

/** A person, as the gate and the sign-in need one. */
export interface UserRow {
  id: string
  enabled: boolean
  created_at: string
  enabled_at: string | null
}

/** One external identity, and the person it belongs to. */
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
 * What the gate asks for, and it is one row rather than two.
 *
 * The join is the design. `enabled` is read from `user` on every request rather
 * than copied onto the session, so disabling somebody takes effect on their next
 * request instead of whenever their session happens to expire.
 */
export interface LiveSession {
  token_hash: string
  user_id: string
  last_used_at: string
  expires_at: string
  enabled: boolean
}

/** A half-finished sign-in, as the callback consumes one. */
export interface FlowRow {
  state: string
  provider: string
  code_verifier: string
  nonce: string
  next: string
}

/** A person and the identities they hold, which is what the script prints. */
export interface UserWithIdentities extends UserRow {
  identities: IdentityRow[]
}

export class AuthStore {
  constructor(private readonly db: Db) {}

  /**
   * The one question the gate asks, answered in one round trip.
   *
   * A session is live when it exists, has not been revoked and has not expired.
   * A revoked or expired row answers nothing, which is the same answer as no row
   * at all: `anonymous`, and a `401`. Whether the person may come in is a
   * separate field and a separate refusal.
   *
   * **Nothing about the person beyond `enabled` is read here**, and that is
   * because this runs on every request the app answers. Their email and name are
   * wanted by exactly one route, `GET /api/auth/session`, which asks
   * `latestIdentity` for them; putting that join here would make every request
   * for a photograph pay for a screen's caption.
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
   * The identity this person most recently signed in with.
   *
   * A person may hold more than one, and the screen that says "signed in as"
   * should say the one they just used rather than the first they ever had.
   * Absent only for a user with no identity at all, which nothing here creates.
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
   * Start a session for a person who has just proved who they are.
   *
   * Takes the hash, never the token: the caller mints the random value, hands it
   * to exactly one browser, and gives this the digest. Nothing in this process
   * keeps the token after the response is written.
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
   * Push a session's window forward, and only when it has gone stale.
   *
   * The `last_used_at` condition is in the statement rather than in the caller
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
   * The person behind an external identity, creating them if this pair has never
   * been seen.
   *
   * **A new pair is a new person, always.** Not a match on email, not a prompt,
   * not a merge: see the header, and `schema.ts` on `user_identity`. The row is
   * created with `enabled` false, which is the schema's default and is written
   * here as nothing rather than as `false`, so there is no second place the
   * default could be changed.
   *
   * `email` and `name` are refreshed on every sign-in because a provider is the
   * authority on both and they change. `last_seen_at` moves with them, which is
   * what makes "the identity they just used" answerable.
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
   * Everybody, newest first, with the identities each holds.
   *
   * The enable script's whole read. Two queries rather than a join, because the
   * shape wanted is a person with a list under them and a join hands back a row
   * per identity, which the caller would then have to fold. There is one owner
   * and a waiting list, so the number of rows is not the consideration.
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
   * several.
   *
   * Several is not an error here and is not resolved here. It is handed back so
   * the script can refuse and print them, because picking one would be this
   * codebase deciding that an address identifies a person, which is the thing
   * #510 says it does not.
   */
  async byEmail(email: string): Promise<UserWithIdentities[]> {
    const everyone = await this.everybody()
    const wanted = email.trim().toLowerCase()
    return everyone.filter((person) =>
      person.identities.some((one) => one.email.trim().toLowerCase() === wanted))
  }

  /**
   * Let somebody in, or stop letting them in.
   *
   * `enabled_at` records when the door was opened and is cleared when it is
   * shut, so a person who was admitted and then was not does not read as having
   * been admitted all along.
   *
   * **Disabling does not touch their sessions on purpose.** The gate reads
   * `enabled` on every request, so the next one they make answers `403`. A
   * revocation sweep exists as its own switch for the different question of
   * "throw away the credential", which is what you want after a stolen phone
   * rather than after a decision about who is admitted.
   *
   * Answers whether anything changed. A row already in the wanted state matches
   * nothing and reports `false`, which is what lets the script say "already
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
   * Take a half-finished sign-in, once.
   *
   * `DELETE ... RETURNING` rather than a select and a delete, so two callbacks
   * carrying the same state cannot both be answered: exactly one statement
   * removes the row and only that one gets it back. An authorization code that
   * is replayed therefore fails with nothing to check it against, which is what
   * the row is for.
   *
   * Expired flows are swept in the same statement rather than on a timer,
   * because the only thing that has to be true of them is that they cannot be
   * used, and a delete on the way past is cheaper than something that has to be
   * running.
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
