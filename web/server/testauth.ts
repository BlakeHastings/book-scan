/**
 * A session a test can hold, made the way the app makes one (#521).
 *
 * Test support only. Nothing the server runs imports this file.
 *
 * ## Why every route test needed one
 *
 * The gate covers every path under `/api`, which is every route this app has,
 * so a test that drives a route over HTTP now has to arrive holding a session
 * exactly as a phone does. That is the point rather than an inconvenience: a
 * suite that could reach the routes without one would be proving the app as it
 * is not deployed.
 *
 * ## It writes the same rows the sign-in writes, through the same code
 *
 * `AuthStore.findOrCreate` and `AuthStore.openSession` are the two calls
 * `server/auth/gate.ts` makes when Google's callback comes back, and they are
 * the two calls here. There is no test-only path into the session table, so a
 * change to how a session is stored breaks this the same way it would break a
 * sign-in, rather than leaving the suite green against a shape the app no longer
 * writes.
 *
 * The token is hashed here for the same reason it is hashed there: what goes in
 * the cookie never goes in the database.
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
 * `enabled` defaults to true because almost every test in this suite is about
 * something other than the gate and wants to be through it. The tests that are
 * about the gate ask for `false` and get the middle state, which is the one that
 * gets missed.
 *
 * The subject is randomised per call so two sessions made in one test are two
 * people rather than one person twice, which is what a test about revocation
 * needs.
 */
export async function signedIn(
  db: Db,
  options: { enabled?: boolean; subject?: string; email?: string; name?: string } = {},
): Promise<TestSession> {
  const store = new AuthStore(db)
  const now = new Date()
  const subject = options.subject ?? `test-${randomBytes(6).toString('hex')}`

  const person = await store.findOrCreate({
    // Not a URL and not anything a provider could assert, the same shape the
    // development door uses, so a row written by a test could never be mistaken
    // for one written by Google.
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
