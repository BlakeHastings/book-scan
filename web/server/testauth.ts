/**
 * A session a test can hold, made the way the app makes one.
 *
 * Test support only; nothing the server runs imports this file.
 *
 * Writes through the same calls the real sign-in uses,
 * `AuthStore.findOrCreate` and `AuthStore.openSession`. There is no
 * test-only path into the session table, so a change to how a session is
 * stored breaks this the same way it would break a sign-in. The token is
 * hashed here for the same reason it is hashed there: what goes in the
 * cookie never goes in the database.
 */

import { createHash, randomBytes } from 'node:crypto'

import { AuthStore } from '../infrastructure/auth/auth-store'
import { SESSION_COOKIE } from '../shared/auth'
import type { Db } from './driver'

/** What a test needs to make a request, and what it needs to assert about. */
export interface TestSession {
  /** Ready for a `Cookie:` header. */
  cookie: string
  /** The raw cookie value, for a test that builds its own header. */
  token: string
  /** The id this app owns. */
  userId: string
}

/**
 * A person, and a session they hold.
 *
 * `enabled` defaults to true, since most tests are about something other
 * than the gate and want to be through it; tests about the gate itself ask
 * for `false`.
 *
 * The subject is randomised per call so two sessions made in one test are
 * two people rather than one person twice.
 */
export async function signedIn(
  db: Db,
  options: { enabled?: boolean; subject?: string; email?: string; name?: string } = {},
): Promise<TestSession> {
  const store = new AuthStore(db)
  const now = new Date()
  const subject = options.subject ?? `test-${randomBytes(6).toString('hex')}`

  const person = await store.findOrCreate({
    // Not a URL and not anything a provider could assert, so a row written
    // by a test could never be mistaken for one written by Google.
    issuer: 'bookscan:test',
    subject,
    email: options.email ?? `${subject}@example.test`,
    name: options.name ?? 'A Test',
  }, now)

  if (options.enabled ?? true) await store.setEnabled(person.id, true, now)

  const token = randomBytes(32).toString('base64url')
  await store.openSession(createHash('sha256').update(token).digest('hex'), person.id, now)

  return { cookie: `${SESSION_COOKIE}=${token}`, token, userId: person.id }
}
