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
    scratchTag: string
  }
}

/**
 * The name for a scratch database, marked with this run's tag.
 *
 * The tag is what `pgcontainer.ts`'s teardown sweeps by, and it is why the
 * sweep cannot reach a database another run of this suite is using. Shared with
 * `infrastructure/db/testdb.ts`, which makes the other kind, so there is one
 * spelling of the shape the sweep matches rather than two that have to agree.
 */
export function scratchName(kind: 'test' | 'scratch'): string {
  return `bookscan_${kind}_${inject('scratchTag')}_${randomBytes(6).toString('hex')}`
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
 * The catalogue as it stood when the copy was taken, put back.
 *
 * **This was a truncate of six named tables and five repairs to the furniture,
 * and it had drifted** (#343). The repairs put back what somebody had noticed a
 * test changing: extra areas, extra fixtures, a moved anchor, a name. What they
 * did not put back was which fixture a `placement_rule` points at, which is the
 * one thing `relocate-run.test.ts` exists to change. So that file, and
 * `carry.test.ts` beside it, closed and rebuilt a whole database between every
 * test to get a clean floor, at twelve `CREATE DATABASE` and twelve `DROP
 * DATABASE` a file, and a drop forces an immediate checkpoint across the whole
 * server. The two heaviest files in the suite were generating the contention
 * they then lost to, and the reason was a reset that did not cover the rows they
 * wrote.
 *
 * A list of repairs can only cover what somebody thought of. A copy of every
 * table covers whatever the next test writes, including into tables that do not
 * exist yet, so this one cannot drift the same way. **The tables come from the
 * catalogue rather than from a list here**, which is the rule
 * `server/backup.ts` already follows and for the same reason: a table added to
 * the schema is covered by having been added.
 *
 * The copies live in a schema of their own, so nothing that reads the catalogue
 * can see them. That matters concretely: the backup digest builds its list from
 * `pg_class` where `nspname = 'public'`, and a copy of `area` sitting in
 * `public` would be a table it counted.
 *
 * One `TRUNCATE` naming every table at once, so no foreign key can complain
 * about the order it is emptied in, and `RESTART IDENTITY` so an empty table
 * numbers from 1 the way the old truncate did. The inserts then go parent
 * before child, in an order taken from `pg_constraint` rather than written
 * down, and each identity sequence is wound forward past the rows just put back.
 *
 * The whole thing is one string and one round trip. That is not tidiness: it is
 * run between every test in fifteen files, and this suite's problem is round
 * trips to a contended server.
 */
async function copyOfTheCatalogue(pool: pg.Pool, called: string): Promise<string> {
  // A schema name goes into SQL that cannot be parameterised, and the callers
  // are test files rather than a request, so this refuses rather than quotes.
  if (!/^[a-z][a-z0-9_]*$/.test(called)) {
    throw new Error(`a kept catalogue is named in lower case words: ${called}`)
  }
  const schema = `kept_${called}`
  const tables = await tablesInOrder(pool)

  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`)
  await pool.query(
    tables.map((table) => `CREATE TABLE ${schema}.${table} AS TABLE public.${table};`).join('\n'),
  )

  const numbered = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'id' AND is_identity = 'YES'`,
  )

  return [
    `TRUNCATE ${tables.map((table) => `public.${table}`).join(', ')} RESTART IDENTITY CASCADE;`,
    ...tables.map((table) => `INSERT INTO public.${table} TABLE ${schema}.${table};`),
    ...numbered.rows.map(({ table_name: table }) =>
      `SELECT setval(pg_get_serial_sequence('public.${table}', 'id'),` +
      ` coalesce(max(id), 1), max(id) IS NOT NULL) FROM public.${table};`),
  ].join('\n')
}

/**
 * Every ordinary table in `public`, parents before the tables that reference
 * them, so a row can always be inserted with the row it points at already there.
 *
 * `relkind = 'r'` leaves out the three views, which have no rows of their own.
 * A cycle would be two tables that reference each other, which this schema does
 * not have and which is said out loud rather than assumed: an unresolved table
 * is thrown about rather than quietly dropped from the restore.
 */
async function tablesInOrder(pool: pg.Pool): Promise<string[]> {
  const { rows: all } = await pool.query<{ table_name: string }>(
    `SELECT c.relname AS table_name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  )
  const { rows: edges } = await pool.query<{ child: string; parent: string }>(
    `SELECT child.relname AS child, parent.relname AS parent
       FROM pg_constraint fk
       JOIN pg_class child ON child.oid = fk.conrelid
       JOIN pg_class parent ON parent.oid = fk.confrelid
       JOIN pg_namespace n ON n.oid = child.relnamespace
      WHERE fk.contype = 'f' AND n.nspname = 'public'`,
  )

  const waitingFor = new Map(all.map(({ table_name: table }) => [table, new Set<string>()]))
  for (const { child, parent } of edges) {
    if (child !== parent) waitingFor.get(child)?.add(parent)
  }

  const ordered: string[] = []
  while (waitingFor.size) {
    const ready = [...waitingFor].filter(([, on]) => !on.size).map(([table]) => table)
    if (!ready.length) {
      throw new Error(
        `these tables reference each other in a cycle, so there is no order to ` +
        `put their rows back in: ${[...waitingFor.keys()].join(', ')}`,
      )
    }
    for (const table of ready) {
      ordered.push(table)
      waitingFor.delete(table)
    }
    for (const on of waitingFor.values()) for (const table of ready) on.delete(table)
  }
  return ordered
}

interface Catalogue {
  db: Db
  pool: pg.Pool
  name: string
  serverUrl: string
  /** Per kept copy, the one statement that puts it back. See `copyOfTheCatalogue`. */
  restore: Map<string, string>
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
  const name = scratchName('test')

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

  const restore = new Map([['empty', await copyOfTheCatalogue(pool, 'empty')]])
  return { db: new PgDb(pool), pool, name, serverUrl: server, restore }
}

/**
 * A database in the state `as` names, which by default is the one the schema
 * left behind: migrated, the furniture seeded, and nothing else in it.
 *
 * Call it in a `beforeEach`. The second and later calls in a file put the
 * catalogue back rather than making another database, and any state
 * `keepThisCatalogue` has been given a name for can be asked for by that name.
 */
export async function openTestDatabase(as = 'empty'): Promise<Db> {
  if (!catalogue) {
    catalogue = await createCatalogue()
    if (as !== 'empty') await openTestDatabase(as)
    return catalogue.db
  }
  const restore = catalogue.restore.get(as)
  if (!restore) {
    throw new Error(
      `no catalogue has been kept under the name ${as}. ` +
      `Kept so far: ${[...catalogue.restore.keys()].join(', ')}`,
    )
  }
  await catalogue.pool.query(restore)
  return catalogue.db
}

/**
 * Keep the catalogue as it stands now, under a name, so a later
 * `openTestDatabase(name)` puts exactly this back.
 *
 * **For a file whose fixture costs more than the test does.** `carry.test.ts`
 * and `relocate-run.test.ts` each shelve fifty-three books through the whole
 * save path to build the room the owner actually has, which is about 250
 * sequential round trips, and each of them did it in all twelve of its tests.
 * On a machine running this suite beside somebody else's, those 250 round trips
 * measured 78 seconds against a twenty second budget. Built once and put back,
 * the same world costs one round trip a test.
 *
 * The name is there because a file can want more than one world.
 * `furniture.routes.test.ts` wants a small room for forty-two of its tests and
 * the owner's own fifty for two of them, and neither is the empty catalogue its
 * `beforeEach` starts from.
 *
 * **What this gives up, said rather than glossed:** a fixture kept this way is
 * built once per file instead of once per test. Nothing here was proving
 * anything by the repetition, because these worlds are the setup and not the
 * subject, but a file whose setup is what it is testing should not call this.
 */
export async function keepThisCatalogue(as: string): Promise<void> {
  if (!catalogue) throw new Error('open the test database before keeping what is in it')
  catalogue.restore.set(as, await copyOfTheCatalogue(catalogue.pool, as))
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
 * Give the connections back. The database is left standing.
 *
 * Called from an `afterAll` in each file that opens one. A pool left open holds
 * the worker alive, so closing it is the part that has to happen here.
 *
 * **Dropping it does not, and used to, and that was the expensive half** (#343).
 * `DROP DATABASE` forces an immediate checkpoint and waits for it, which flushes
 * every dirty buffer in the whole server rather than this database's, so a drop
 * issued from an `afterAll` while fifteen other worker processes are mid-test
 * both waits on their writes and stalls them. It is dropped in
 * `pgcontainer.ts`'s teardown instead, after the last test, or not at all when
 * the container this run started is about to be removed with it inside.
 *
 * Calling this and then `openTestDatabase()` again therefore makes a **second**
 * database rather than reusing the first, and there is no reason to: the second
 * and later calls to `openTestDatabase` already empty the tables. Two files did
 * it from an `afterEach` and were the two files #343 was filed about.
 */
export async function closeTestDatabase(): Promise<void> {
  if (!catalogue) return
  const { db } = catalogue
  catalogue = undefined
  await db.close()
}
