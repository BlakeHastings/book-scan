/**
 * A migrated Postgres database of a test file's own. Test support only.
 * `server/testdb.ts` is the older sibling and is a different thing on
 * purpose: it builds a database from `applySchema`, the six-table baseline
 * the app shipped before Drizzle. This one runs the migrations, which is
 * the only way to get a database with `tag` and `book_tag` in it.
 *
 * `BOOKSCAN_TEST_DATABASE_URL` is the only connection variable read here,
 * the same as everywhere else in this suite. See `server/pgcontainer.ts`
 * for why that matters.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { inject } from 'vitest'
import { scratchName } from '../../server/testdb'
import { migrateToLatest } from './migrate'

/**
 * Created with a linguistic collation on purpose, exactly as
 * `server/testdb.ts` does it: on a byte-ordered database every
 * `COLLATE "C"` claim would hold regardless, and the declaration could be
 * deleted with nothing noticing until a managed Postgres handed the app a
 * linguistic one.
 */
const HOSTILE_COLLATIONS = ['en_US.utf8', 'en_US.UTF-8', 'en-US-x-icu']

const serverUrl = () => process.env.BOOKSCAN_TEST_DATABASE_URL ?? inject('postgresUrl')

/**
 * The pools this file has open. Not the database names: nothing here drops one
 * any more, and the sweep in `server/pgcontainer.ts` finds them by the tag in
 * their name rather than by being told.
 */
const opened: pg.Pool[] = []

export function poolFor(connectionString: string): pg.Pool {
  // `idleTimeoutMillis` is a second rather than node-postgres's ten: many
  // files hold a pool per scratch database open until their `afterAll`,
  // and with several running in parallel that can exceed postgres's
  // hundred-connection limit. Giving an idle connection back sooner costs
  // a reconnect the next test would have paid for anyway.
  const pool = new pg.Pool({ connectionString, idleTimeoutMillis: 1_000 })
  // node-postgres throws on an `error` event with no listener, which surfaces as
  // a file failing with every test in it passing. See PgDb.
  pool.on('error', () => {})
  return pool
}

/** An empty database of its own. Nothing has been applied to it. */
export async function scratchDatabase(): Promise<pg.Pool> {
  const server = serverUrl()
  const name = scratchName('scratch')

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
  opened.push(pool)
  return pool
}

/** The same, with every migration applied: the schema the app is moving to. */
export async function migratedDatabase(): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await migrateToLatest(pool)
  return pool
}

/**
 * Apply the migrations after the baseline, up to and including one named
 * file, to a database that already has the baseline schema.
 *
 * This exists because a migration can be watched running only while the
 * columns it reads still exist: `0016` repairs a book's genre tags by
 * keeping the one that agrees with `books.is_fiction`, and the cut-over
 * drops that column further down the folder, so migrating to latest and
 * then running `0016` by hand would run it against a catalogue it could
 * never have met.
 *
 * Statement for statement the way Drizzle's migrator applies them,
 * starting at `0001` since a database built from `SCHEMA` already has the
 * baseline. Nothing is recorded in Drizzle's bookkeeping, since a database
 * this has touched is a fixture rather than a catalogue under migration
 * control.
 */
export async function migrationsThrough(pool: pg.Pool, tag: string): Promise<void> {
  const journal = JSON.parse(readFileSync(
    fileURLToPath(new URL('./migrations/meta/_journal.json', import.meta.url)), 'utf8',
  )) as { entries: { tag: string }[] }

  const wanted = journal.entries.findIndex((entry) => entry.tag === tag)
  if (wanted < 0) throw new Error(`there is no migration called ${tag}`)

  for (const entry of journal.entries.slice(1, wanted + 1)) {
    const sql = readFileSync(
      fileURLToPath(new URL(`./migrations/${entry.tag}.sql`, import.meta.url)), 'utf8',
    )
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await pool.query(statement)
    }
  }
}

/**
 * Give the connections back. The databases this file made are left
 * standing, and a pool left open holds the worker alive, which is why this
 * still has to happen here.
 *
 * The drops used to happen here too. `DROP DATABASE` forces an immediate
 * checkpoint that flushes every dirty buffer in the server, so dropping
 * many databases from each file's own `afterAll` stalled every other
 * worker process. They are dropped in `server/pgcontainer.ts`'s teardown
 * now, once, after the last test in the run; the database name carries
 * this run's tag so that sweep can find only this run's.
 */
export async function closeScratchDatabases(): Promise<void> {
  const made = opened.splice(0)
  if (!made.length) return

  await Promise.all(made.map((pool) => pool.end().catch(() => undefined)))
}
