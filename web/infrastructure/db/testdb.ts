/**
 * A migrated Postgres database of a test file's own.
 *
 * Test support only, and it imports `vitest`, so nothing the server runs could
 * reach it. `server/testdb.ts` is the older sibling and is a different thing on
 * purpose: it builds a database from `applySchema`, which is the six-table
 * baseline the app shipped before Drizzle, and it is what the files that run on
 * both drivers use. This one runs the migrations, which is the only way to get a
 * database with `tag` and `book_tag` in it.
 *
 * `BOOKSCAN_TEST_DATABASE_URL` is the only connection variable read here, the
 * same as everywhere else in this suite. See `server/pgcontainer.ts` for why
 * that matters.
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'
import { migrateToLatest } from './migrate'

/**
 * Created with a linguistic collation on purpose, exactly as `server/testdb.ts`
 * does it. On a byte-ordered database every `COLLATE "C"` claim would hold
 * because the whole database ordered that way, and the declaration could be
 * deleted with nothing noticing until a managed Postgres handed the app a
 * linguistic one.
 */
const HOSTILE_COLLATIONS = ['en_US.utf8', 'en_US.UTF-8', 'en-US-x-icu']

const serverUrl = () => process.env.BOOKSCAN_TEST_DATABASE_URL ?? inject('postgresUrl')

const opened: { pool: pg.Pool; name: string }[] = []

export function poolFor(connectionString: string): pg.Pool {
  /*
   * `idleTimeoutMillis` is a second rather than node-postgres's ten, and it is
   * about the whole run rather than about this pool.
   *
   * Every file here holds a pool per scratch database until its `afterAll`, and
   * a pool that has run one query parks that connection for as long as the
   * timeout says. Postgres allows a hundred at once. With a dozen files in
   * parallel, several of them making a dozen databases each, the run reached
   * that number and whichever file asked next failed with `sorry, too many
   * clients already` — in a file that had done nothing wrong, which is the worst
   * kind of failure to read. Giving an idle connection back after a second costs
   * a reconnect the next test would have paid for anyway.
   */
  const pool = new pg.Pool({ connectionString, idleTimeoutMillis: 1_000 })
  // node-postgres throws on an `error` event with no listener, which surfaces as
  // a file failing with every test in it passing. See PgDb.
  pool.on('error', () => {})
  return pool
}

/** An empty database of its own. Nothing has been applied to it. */
export async function scratchDatabase(): Promise<pg.Pool> {
  const server = serverUrl()
  const name = `bookscan_scratch_${randomBytes(6).toString('hex')}`

  const admin = poolFor(server)
  try {
    let created = false
    for (const collation of HOSTILE_COLLATIONS) {
      try {
        await admin.query(
          `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' ` +
          `LC_COLLATE '${collation}' LC_CTYPE '${collation}'`,
        )
        created = true
        break
      } catch {
        // Next spelling; a server with none of them falls through.
      }
    }
    if (!created) await admin.query(`CREATE DATABASE ${name}`)
  } finally {
    await admin.end()
  }

  const target = new URL(server)
  target.pathname = `/${name}`
  const pool = poolFor(target.href)
  opened.push({ pool, name })
  return pool
}

/** The same, with every migration applied: the schema the app is moving to. */
export async function migratedDatabase(): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await migrateToLatest(pool)
  return pool
}

/**
 * Give the connections back and drop the databases this file made.
 *
 * Called from an `afterAll`. A pool left open holds the worker alive; a database
 * left behind matters on a server the escape hatch pointed at, which is exactly
 * the server somebody has to live with.
 *
 * Three things here are about the ten second hook timeout rather than about
 * correctness, and they were each measured: **one admin connection for every
 * drop** instead of a pool per database, the pools closed **together** rather
 * than one after another, and `WITH (FORCE)`, so a drop does not wait on a
 * connection something else has not finished closing. A file that makes half a
 * dozen databases was timing out in its teardown under a full parallel run and
 * failing with every test in it passing.
 */
export async function dropScratchDatabases(): Promise<void> {
  const made = opened.splice(0)
  if (!made.length) return

  await Promise.all(made.map(({ pool }) => pool.end().catch(() => undefined)))

  const admin = poolFor(serverUrl())
  try {
    await Promise.all(made.map(({ name }) =>
      admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
        // A scratch database left behind is not worth failing a green run over.
        .catch(() => undefined)))
  } finally {
    await admin.end().catch(() => undefined)
  }
}
