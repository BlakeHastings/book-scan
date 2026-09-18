/**
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
 * The name for a scratch database, marked with this run's tag. The tag is what
 * `pgcontainer.ts`'s teardown sweeps by, and it is why the sweep cannot reach a
 * database another run of this suite is using. `infrastructure/db/testdb.ts`
 * makes the other kind from the same spelling.
 */
export function scratchName(kind: 'test' | 'scratch'): string {
  return `bookscan_${kind}_${inject('scratchTag')}_${randomBytes(6).toString('hex')}`
}

/**
 * Test databases are created with a linguistic collation on purpose: under a byte
 * order collation every check of the `COLLATE "C"` declarations would pass
 * because the whole database ordered correctly. Tried in order, because the
 * spellings differ by platform.
 */
const HOSTILE_COLLATIONS = ['en_US.utf8', 'en_US.UTF-8', 'en-US-x-icu']

/**
 * The catalogue as it stood when the copy was taken, put back.
 *
 * The tables come from the catalogue rather than from a list here, so a table
 * added to the schema is covered by having been added. The copies live in a
 * schema of their own because the backup digest builds its list from `pg_class`
 * where `nspname = 'public'`, and a copy of `area` sitting in `public` would be a
 * table it counted.
 *
 * One `TRUNCATE` naming every table at once, so no foreign key can complain
 * about the order it is emptied in, and `RESTART IDENTITY` so an empty table
 * numbers from 1. The inserts then go parent before child, in an order taken
 * from `pg_constraint`, and each identity sequence is wound forward past the rows
 * just put back. The whole thing is one string and one round trip because it runs
 * between every test in fifteen files.
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

  // Quoted for the same reason as above: a name that needs quoting in one
  // statement needs it in all of them.
  const numbered = await pool.query<{ table_name: string }>(
    `SELECT quote_ident(table_name) AS table_name FROM information_schema.columns
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
 * `relkind = 'r'` leaves out the three views, which have no rows of their own. An
 * unresolved table is thrown about rather than quietly dropped from the restore.
 */
async function tablesInOrder(pool: pg.Pool): Promise<string[]> {
  /*
   * `quote_ident`, because a table can be named after a reserved word and one is:
   * `user` is `USER` the SQL function unless it is quoted. The names come back
   * quoted, so every use of them below is already a `"user"` rather than a
   * `user`.
   */
  const { rows: all } = await pool.query<{ table_name: string }>(
    `SELECT quote_ident(c.relname) AS table_name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  )
  // Quoted here too, so the names on both sides of an edge are the same strings
  // the map above is keyed by.
  const { rows: edges } = await pool.query<{ child: string; parent: string }>(
    `SELECT quote_ident(child.relname) AS child, quote_ident(parent.relname) AS parent
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
 * One database per test file, reused between the tests in it. Vitest gives each
 * test file its own module registry, so this module-scope value is per file
 * rather than per run.
 */
let catalogue: Catalogue | undefined

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
 * every test in it passing.
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
    // fallback shows up as a failing test.
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
 * left behind: migrated, the furniture seeded, and nothing else in it. The second
 * and later calls in a file put the catalogue back rather than making another
 * database.
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
 * A fixture kept this way is built once per file instead of once per test, so a
 * file whose setup is what it is testing should not call this.
 */
export async function keepThisCatalogue(as: string): Promise<void> {
  if (!catalogue) throw new Error('open the test database before keeping what is in it')
  catalogue.restore.set(as, await copyOfTheCatalogue(catalogue.pool, as))
}

/**
 * The connection string for the database `openTestDatabase` handed back, for the
 * one test that has to hand a connection to the code that resolves one.
 * Everything else takes the `Db` and never learns where it came from.
 */
export function testDatabaseUrl(): string {
  if (!catalogue) throw new Error('open the test database before asking where it is')
  const url = new URL(catalogue.serverUrl)
  url.pathname = `/${catalogue.name}`
  return url.href
}

/**
 * Give the connections back. A pool left open holds the worker alive, so closing
 * it is the part that has to happen here.
 *
 * The database is left standing, because `DROP DATABASE` forces an immediate
 * checkpoint across the whole server and would stall the other workers mid-test.
 * `pgcontainer.ts`'s teardown drops it after the last test instead. Calling this
 * and then `openTestDatabase()` again therefore makes a second database rather
 * than reusing the first, and there is no reason to: the second and later calls
 * to `openTestDatabase` already empty the tables.
 */
export async function closeTestDatabase(): Promise<void> {
  if (!catalogue) return
  const { db } = catalogue
  catalogue = undefined
  await db.close()
}
