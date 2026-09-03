/**
 * The one command that decides who is allowed in (#521).
 *
 * `gate.routes.test.ts` proves what `enabled` does to a request. What is tested
 * here is the part of this script that is a judgement rather than an update:
 *
 * - **Asking does not write.** The ordinary use lists and stops, which is
 *   `rebuild-projection.ts`'s shape and is here for the same reason.
 * - **An ambiguous email is refused rather than resolved.** #510 says two
 *   providers can assert one address about different people, and this is the one
 *   place in the codebase where somebody is allowed to type an address. Picking
 *   one of two would be this repository deciding the thing that document says it
 *   must not.
 * - **The target is never taken from the running app's connection.** That is the
 *   rule `seed-world.ts` and `rebuild-projection.ts` already follow, and it
 *   matters more here: this writes.
 */

import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from '../server/db.pg'
import type { Db } from '../server/driver'
import { AuthStore, type UserWithIdentities } from '../infrastructure/auth/auth-store'
import { describePerson, findPerson, listEverybody, readArgs } from './enable-user'

let pool: pg.Pool
let db: Db
let store: AuthStore

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  store = new AuthStore(db)
})

afterAll(async () => {
  await closeScratchDatabases()
})

beforeEach(async () => {
  await pool.query('TRUNCATE "user" CASCADE')
})

/** Somebody who has signed in, the way a first sign-in leaves them. */
async function knocked(subject: string, email: string) {
  return store.findOrCreate(
    { issuer: 'https://accounts.google.com', subject, email, name: subject },
    new Date(),
  )
}

describe('reading the command line', () => {
  it('refuses to take the target from anywhere but the command line or its own variable', () => {
    const read = readArgs([], {
      // The name the running app reads. It must not be able to decide what this
      // writes to, which is the whole rule.
      ConnectionStrings__bookscan: 'postgres://somewhere/real',
    } as NodeJS.ProcessEnv)

    expect(read).toEqual({ error: expect.stringContaining('No target') })
  })

  it('takes its own variable when the command line does not name one', () => {
    const read = readArgs([], { BOOKSCAN_ENABLE_TARGET: 'postgres://scratch/x' } as NodeJS.ProcessEnv)
    expect(read).toMatchObject({ target: 'postgres://scratch/x' })
  })

  it('refuses an argument it does not recognise rather than ignoring it', () => {
    const read = readArgs(['--target', 'x', '--enable-everybody'], {} as NodeJS.ProcessEnv)
    expect(read).toEqual({ error: expect.stringContaining('--enable-everybody') })
  })

  it('refuses two decisions in one command', () => {
    const read = readArgs(
      ['--target', 'x', '--enable', 'a', '--disable', 'b'],
      {} as NodeJS.ProcessEnv,
    )
    expect(read).toEqual({ error: expect.stringContaining('one at a time') })
  })

  it('refuses a flag with nothing after it', () => {
    expect(readArgs(['--target', 'x', '--enable'], {} as NodeJS.ProcessEnv))
      .toEqual({ error: expect.stringContaining('--enable needs a value') })
  })
})

describe('naming a person', () => {
  it('finds them by the id this app owns', async () => {
    const person = await knocked('sub-1', 'one@example.test')
    const everyone = await store.everybody()

    expect(findPerson(everyone, person.id)).toMatchObject({ person: { id: person.id } })
  })

  it('finds them by an address, when exactly one person has it', async () => {
    const person = await knocked('sub-1', 'one@example.test')
    const everyone = await store.everybody()

    expect(findPerson(everyone, 'ONE@example.test')).toMatchObject({ person: { id: person.id } })
  })

  /**
   * The refusal #510 asks for, in the one place an address may be typed at all.
   * Two subjects with one address is not one person, and this will not choose.
   */
  it('refuses an address two people have signed in with, and prints both', async () => {
    const first = await knocked('sub-1', 'shared@example.test')
    const second = await knocked('sub-2', 'shared@example.test')
    const everyone = await store.everybody()

    const found = findPerson(everyone, 'shared@example.test')
    expect(found).toHaveProperty('refusal')
    const refusal = (found as { refusal: string }).refusal
    expect(refusal).toContain('is not an identity')
    expect(refusal).toContain(first.id)
    expect(refusal).toContain(second.id)
  })

  it('says so plainly when nobody is named', async () => {
    expect(findPerson([], 'nobody@example.test')).toEqual({
      refusal: expect.stringContaining('Nobody here is nobody@example.test'),
    })
  })
})

describe('listing', () => {
  it('writes nothing at all', async () => {
    await knocked('sub-1', 'one@example.test')
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const before = await store.everybody()
    await listEverybody(db)
    const after = await store.everybody()

    expect(after).toEqual(before)
    expect(after.every((one) => !one.enabled)).toBe(true)
    vi.restoreAllMocks()
  })

  it('says out loud that a first sign-in creates somebody disabled', async () => {
    const said: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line) => { said.push(String(line)) })

    await listEverybody(db)

    expect(said.join('\n')).toContain('disabled')
    vi.restoreAllMocks()
  })

  it('shows which state each person is in, and the address a human recognises', async () => {
    const person = await knocked('sub-1', 'one@example.test')
    const [row] = await store.everybody()

    expect(describePerson(row as UserWithIdentities)).toContain('waiting')
    expect(describePerson(row as UserWithIdentities)).toContain(person.id)
    expect(describePerson(row as UserWithIdentities)).toContain('one@example.test')

    await store.setEnabled(person.id, true, new Date())
    const [after] = await store.everybody()
    expect(describePerson(after as UserWithIdentities)).toContain('enabled')
  })
})

describe('the two decisions this makes, and that they are two', () => {
  it('says nothing was written when somebody is already in that state', async () => {
    const person = await knocked('sub-1', 'one@example.test')

    expect(await store.setEnabled(person.id, true, new Date())).toBe(true)
    expect(await store.setEnabled(person.id, true, new Date())).toBe(false)
  })

  /**
   * Disabling somebody is not signing them out, and the difference is the point.
   * The gate reads `enabled` on every request, so a disabled person's live
   * session answers `403` — the waiting-list screen — rather than vanishing and
   * sending them round the sign-in loop.
   */
  it('leaves a disabled person holding their session', async () => {
    const person = await knocked('sub-1', 'one@example.test')
    await store.setEnabled(person.id, true, new Date())
    await store.openSession('a-hash-of-something', person.id, new Date())

    await store.setEnabled(person.id, false, new Date())

    const live = await store.liveSession('a-hash-of-something', new Date())
    expect(live).toBeTruthy()
    expect(live?.enabled).toBe(false)
  })

  it('ends every session when that is what was asked for, and only then', async () => {
    const person = await knocked('sub-1', 'one@example.test')
    await store.setEnabled(person.id, true, new Date())
    await store.openSession('one-hash', person.id, new Date())
    await store.openSession('another-hash', person.id, new Date())

    expect(await store.revokeSessionsFor(person.id, new Date())).toBe(2)
    expect(await store.liveSession('one-hash', new Date())).toBeUndefined()
    expect(await store.liveSession('another-hash', new Date())).toBeUndefined()
    // And they are still enabled: this took the credential, not the admission.
    expect((await store.byId(person.id))?.enabled).toBe(true)
  })

  it('has nothing to end for somebody holding no session', async () => {
    const person = await knocked('sub-1', 'one@example.test')
    expect(await store.revokeSessionsFor(person.id, new Date())).toBe(0)
  })
})
