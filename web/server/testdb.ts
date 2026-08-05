/**
 * Where the four database-touching test files get their database.
 *
 * Test support only. Nothing under `web/server` that the server runs imports
 * this file, and it imports `vitest`, so it could not be reached from one.
 *
 * `store.test.ts`, `shelves.test.ts`, `queue.test.ts` and `rehash.test.ts` run
 * twice: once against SQLite and once against Postgres, selected by
 * `BOOKSCAN_TEST_DRIVER` and configured in vitest.config.ts. That is the whole
 * verification argument for stage F. The Postgres implementation is correct
 * exactly to the extent that the tests already guarding SQLite pass unchanged
 * against it, so **no assertion in those four files may be made conditional on
 * the driver.** If one has to be, the migration changed behaviour and that is
 * the finding.
 *
 * `BOOKSCAN_TEST_DATABASE_URL` is the only connection variable read here. See
 * pgcontainer.ts for why.
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'
import { openDatabase } from './db'
import { applySchema, PgDb } from './db.pg'
import type { Db } from './driver'

declare module 'vitest' {
  interface ProvidedContext {
    postgresUrl: string
  }
}

export type TestDriver = 'sqlite' | 'postgres'

export const TEST_DRIVER: TestDriver =
  process.env.BOOKSCAN_TEST_DRIVER === 'postgres' ? 'postgres' : 'sqlite'

/**
 * A byte order collation would make every check of the `COLLATE "C"`
 * declarations vacuous: the column would order correctly because the whole
 * database does, and the declaration could be deleted with nothing noticing
 * until a managed Postgres handed the app a linguistic one.
 *
 * So the test databases are created with a linguistic collation on purpose, and
 * the fixture in db.pg.test.ts is checked against it. These are tried in order;
 * the spellings differ by platform.
 */
const HOSTILE_COLLATIONS = ['en_US.utf8', 'en_US.UTF-8', 'en-US-x-icu']

/**
 * The five tables a test wants back the way it found them. `shelf_ranges` is
 * not among them: it is seeded by `applySchema`, and a fresh SQLite database
 * arrives seeded too, so emptying it would make the two drivers start from
 * different places.
 *
 * RESTART IDENTITY because a fresh SQLite database numbers from 1 and some
 * fixtures read ids back.
 */
const TRUNCATE =
  'TRUNCATE books, book_authors, captures, separators, author_filing RESTART IDENTITY CASCADE'

interface Catalogue {
  db: Db
  name: string
  serverUrl: string
}

/**
 * One database per test file, reused between the tests in it.
 *
 * Module scope, and vitest gives each test file its own module registry, so
 * this is per file rather than per run. That is what lets the files keep
 * running in parallel while each one still gets a database nothing else writes
 * to.
 */
let catalogue: Catalogue | undefined

/** The server the run was pointed at, either by the escape hatch or the container. */
function serverUrl(): string {
  const fromEnv = process.env.BOOKSCAN_TEST_DATABASE_URL
  if (fromEnv) return fromEnv
  return inject('postgresUrl')
}

async function createCatalogue(): Promise<Catalogue> {
  const server = serverUrl()
  const name = `bookscan_test_${randomBytes(6).toString('hex')}`

  const admin = new pg.Pool({ connectionString: server })
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
        // Next spelling. A server with none of them falls through below.
      }
    }
    // Falling back rather than failing, so a developer's own server still runs
    // the suite. db.pg.test.ts asserts the collation it actually got, so the
    // fallback shows up as a failing test rather than as a check that quietly
    // stopped checking anything.
    if (!created) await admin.query(`CREATE DATABASE ${name}`)
  } finally {
    await admin.end()
  }

  const target = new URL(server)
  target.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: target.href })
  await applySchema(pool)

  return { db: new PgDb(pool), name, serverUrl: server }
}

/**
 * A database in the state a fresh `openDatabase(':memory:')` hands back:
 * schema applied, shelf ranges seeded, nothing else in it.
 */
export async function openTestDatabase(): Promise<Db> {
  if (TEST_DRIVER === 'sqlite') return openDatabase(':memory:')

  if (!catalogue) {
    catalogue = await createCatalogue()
  } else {
    await catalogue.db.run(TRUNCATE)
  }
  return catalogue.db
}

/**
 * Give the connections back and drop the database.
 *
 * Called from an `afterAll` in each of the four files. A pool left open holds
 * the worker alive; a database left behind matters only on a server the escape
 * hatch pointed at, which is exactly the server somebody has to live with.
 */
export async function closeTestDatabase(): Promise<void> {
  if (!catalogue) return
  const { db, name, serverUrl: server } = catalogue
  catalogue = undefined

  await db.close()
  const admin = new pg.Pool({ connectionString: server })
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`)
  } catch {
    // A scratch database left behind is not worth failing a green run over.
  } finally {
    await admin.end()
  }
}
