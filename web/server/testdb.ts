/**
 * Where every test file that opens a database gets one.
 *
 * Test support only. Nothing under `web/server` that the server runs imports
 * this file, and it imports `vitest`, so it could not be reached from one.
 *
 * Until stage I this file also handed back `openDatabase(':memory:')`, and
 * which one a caller got was decided by `BOOKSCAN_TEST_DRIVER`, so five files
 * ran twice and the Postgres driver was correct exactly to the extent that the
 * tests already guarding SQLite passed unchanged against it. That argument has
 * been made and there is one driver left, so there is one database here and no
 * test knows the name of a driver.
 *
 * `BOOKSCAN_TEST_DATABASE_URL` is the only connection variable read here. See
 * pgcontainer.ts for why.
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'
import { applySchema, PgDb } from './db.pg'
import type { Db } from './driver'

declare module 'vitest' {
  interface ProvidedContext {
    postgresUrl: string
  }
}

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
 * The tables a test wants back the way it found them.
 *
 * The furniture is not among them, and cannot be: the fixtures, the areas and
 * the two rules that file into them are seeded by migration `0013`, and a test
 * that opens a database expects to find the two runs standing, exactly as the
 * app does. Emptying those tables would leave the app with nowhere to file.
 *
 * `author` and `author_alias` are named even though `book_author` cascades from
 * `books`, because they do not: a name outlives the last book crediting it, so a
 * test that saved a book would leave an author behind for the next one.
 *
 * RESTART IDENTITY because numbering from 1 is what some fixtures read back.
 */
const TRUNCATE =
  'TRUNCATE books, book_authors, captures, author_filing, ' +
  'author, author_alias RESTART IDENTITY CASCADE'

/**
 * The furniture back to what `0013` leaves on a fresh database, so what a test
 * added to the two runs is put back.
 *
 * A shelf boundary is an `area` row since #232, not a row in a table the
 * truncate above could name, so a test that split a plank leaves a fourth
 * bookcase and three extra planks standing for the next one to find. Each run
 * begins in one area at position 0 on the fixture its rule points at, anchored
 * at the empty string, and everything else on the floor was added by a test.
 *
 * That includes a retired area, which is one at a negative position: it was
 * kept only because a `book_placement` named it, and the truncate cascades to
 * `book_placement`, so by the time these run nothing names an area at all and
 * the deletes are free.
 *
 * **A name is put back too**, because a name is not decoration: every label on a
 * piece is derived from it, so a test that calls bookcase 1 "Hall shelf" leaves
 * every following test in the file reading `Hall shelf · A` where it seeded
 * `1A`. `0013` leaves both names empty and this is what puts them back.
 */
const RESTORE_FURNITURE = [
  'DELETE FROM area WHERE position <> 0 OR fixture_id NOT IN ' +
  '(SELECT fixture_id FROM placement_rule WHERE fixture_id IS NOT NULL)',
  'DELETE FROM fixture WHERE id NOT IN ' +
  '(SELECT fixture_id FROM placement_rule WHERE fixture_id IS NOT NULL)',
  "UPDATE area SET starts_at = '' WHERE starts_at <> ''",
  "UPDATE fixture SET name = '' WHERE name <> ''",
  "UPDATE area SET name = '' WHERE name <> ''",
]

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

/**
 * A short-lived connection for creating and dropping databases.
 *
 * The `error` listener is not optional. node-postgres emits `error` on the pool
 * when an idle client fails, and an `error` event with no listener is one
 * `EventEmitter` throws, which surfaces as the whole test file failing with
 * every test in it passing. `PgDb` carries the same listener for the same
 * reason.
 */
function adminPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString })
  pool.on('error', () => {})
  return pool
}

async function createCatalogue(): Promise<Catalogue> {
  const server = serverUrl()
  const name = `bookscan_test_${randomBytes(6).toString('hex')}`

  const admin = adminPool(server)
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
  const pool = adminPool(target.href)
  await applySchema(pool)

  return { db: new PgDb(pool), name, serverUrl: server }
}

/**
 * A database with the schema applied, the furniture seeded and nothing else in
 * it. Call it in a `beforeEach`: the second and later calls in a file empty
 * the tables rather than making another database.
 */
export async function openTestDatabase(): Promise<Db> {
  if (!catalogue) {
    catalogue = await createCatalogue()
  } else {
    await catalogue.db.run(TRUNCATE)
    for (const statement of RESTORE_FURNITURE) await catalogue.db.run(statement)
  }
  return catalogue.db
}

/**
 * The connection string for the database `openTestDatabase` handed back.
 *
 * For the one test that has to hand a connection to the code that resolves one
 * (`openCatalogue` in index.test.ts). Everything else takes the `Db` and never
 * learns where it came from.
 */
export function testDatabaseUrl(): string {
  if (!catalogue) throw new Error('open the test database before asking where it is')
  const url = new URL(catalogue.serverUrl)
  url.pathname = `/${catalogue.name}`
  return url.href
}

/**
 * Give the connections back and drop the database.
 *
 * Called from an `afterAll` in each file that opens one. A pool left open holds
 * the worker alive; a database left behind matters only on a server the escape
 * hatch pointed at, which is exactly the server somebody has to live with.
 */
export async function closeTestDatabase(): Promise<void> {
  if (!catalogue) return
  const { db, name, serverUrl: server } = catalogue
  catalogue = undefined

  await db.close()
  const admin = adminPool(server)
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`)
  } catch {
    // A scratch database left behind is not worth failing a green run over.
  } finally {
    await admin.end()
  }
}
