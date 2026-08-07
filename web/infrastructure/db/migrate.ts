/**
 * Bringing a Postgres database to the schema in `schema.ts`, whether it has
 * ever been migrated before or not.
 *
 * ## Why this is not just `migrate()`
 *
 * Drizzle's migrator answers one question: which files in the folder have not
 * been recorded in `drizzle.__drizzle_migrations` yet. On a database it has
 * never seen, the answer is "all of them", and it runs the baseline. That is
 * right for an empty database and wrong for every database this project has
 * already created, and there are several: the developer's Postgres container
 * has a persistent volume per checkout (see AGENTS.md), so the tables are
 * already there and `CREATE TABLE "books"` would fail on the first one.
 *
 * Dropping and rebuilding is not an option worth having. It is wrong for a
 * scratch catalogue somebody has been scanning into for a week, and it is the
 * habit that ends up pointed at a real one.
 *
 * So this adopts. A database that already carries the baseline schema gets the
 * baseline **recorded as applied without being run**, which is what brings it
 * under migration control: from that point it is indistinguishable from a
 * database the baseline built, and every migration after the baseline runs on
 * both. This is the standard "baseline an existing database" move, and the only
 * part of it worth arguing about is what counts as "already carries the
 * baseline schema", which is checked rather than assumed below.
 *
 * ## The three states, and what each one gets
 *
 * | The database | What happens | Reported as |
 * | --- | --- | --- |
 * | Empty | The baseline runs and creates everything | `created` |
 * | Has the baseline tables, never migrated | The baseline is recorded, not run | `adopted` |
 * | Already under migration control | Only migrations it has not seen run | `migrated` |
 *
 * A fourth state, some of the tables but not all of them, is refused with the
 * names of the missing ones. That is not a database this can reason about, and
 * guessing at it means either a failed `CREATE TABLE` or a stamped lie.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type pg from 'pg'

/** Where `npm run db:generate` writes, and where the app reads them back. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url))

/** Drizzle's own bookkeeping, spelled the way its migrator spells it. */
const BOOKKEEPING_SCHEMA = 'drizzle'
const BOOKKEEPING_TABLE = '__drizzle_migrations'

/**
 * One advisory lock, so two processes starting at once do not both decide the
 * database is empty.
 *
 * An arbitrary constant rather than a hash of anything: there is one migration
 * sequence per database and nothing else in this app takes a session-scoped
 * lock. Session-scoped rather than transaction-scoped because the work below
 * spans several transactions, and held on a client this function owns and
 * releases, which is the condition driver.ts's warning about session locks
 * turns on: a lock this leaked would be leaked onto a connection that is closed
 * with the process rather than handed to the next request.
 */
const MIGRATION_LOCK = 8_612_004_172n

export type MigrationOutcome = 'created' | 'adopted' | 'migrated'

/** What the baseline creates, as drizzle-kit recorded it when it generated. */
interface Snapshot {
  tables: Record<string, { name: string; columns: Record<string, { name: string }> }>
}

/**
 * The baseline's own snapshot, read rather than derived from `schema.ts`.
 *
 * These are different things and the difference is the point. `schema.ts` is
 * the schema as it will be after every migration in the folder; the snapshot
 * beside `0000_baseline.sql` is the schema as the baseline leaves it. Adoption
 * is a claim about the baseline, so the day a second migration exists this
 * still asks the right question, and a database that has the baseline tables
 * but not the second migration's column is adopted and then migrated rather
 * than refused.
 */
function baselineSnapshot(): Snapshot {
  const path = fileURLToPath(new URL('./migrations/meta/0000_snapshot.json', import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

/** Table name to the column names the baseline gives it, in declaration order. */
function baselineTables(): Map<string, string[]> {
  const tables = new Map<string, string[]>()
  for (const table of Object.values(baselineSnapshot().tables)) {
    tables.set(table.name, Object.values(table.columns).map((column) => column.name))
  }
  return tables
}

/** The columns a live database actually has, for the same six tables. */
async function liveTables(client: pg.PoolClient, wanted: string[]): Promise<Map<string, string[]>> {
  const result = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position`,
    [wanted],
  )

  const tables = new Map<string, string[]>()
  for (const row of result.rows) {
    const columns = tables.get(row.table_name) ?? []
    columns.push(row.column_name)
    tables.set(row.table_name, columns)
  }
  return tables
}

/**
 * Whether this database is the one the baseline would have built.
 *
 * Column names and their order, per table, and nothing else. Deliberately not a
 * full schema comparison: types, defaults, collations and indexes are compared
 * by `migrate.test.ts`, which can build both databases and diff them properly,
 * and doing it here would mean shipping a schema differ into the startup path.
 * What this has to catch is the case that actually happens, which is a database
 * from a different revision of this app, and a schema change here has never yet
 * failed to add or remove a column.
 *
 * It returns the disagreement rather than a boolean, because a refusal that
 * does not say which table and which column sends somebody reading the whole
 * schema.
 */
function differences(baseline: Map<string, string[]>, live: Map<string, string[]>): string[] {
  const found: string[] = []
  for (const [table, columns] of baseline) {
    const actual = live.get(table)
    if (!actual) {
      found.push(`${table} is missing`)
      continue
    }
    const missing = columns.filter((column) => !actual.includes(column))
    const extra = actual.filter((column) => !columns.includes(column))
    if (missing.length) found.push(`${table} has no ${missing.join(', ')}`)
    if (extra.length) found.push(`${table} also has ${extra.join(', ')}`)
  }
  return found
}

/** Has this database ever had a migration recorded against it? */
async function everMigrated(client: pg.PoolClient): Promise<boolean> {
  const present = await client.query<{ table: string | null }>(
    'SELECT to_regclass($1)::text AS table',
    [`${BOOKKEEPING_SCHEMA}.${BOOKKEEPING_TABLE}`],
  )
  if (!present.rows[0]?.table) return false

  const counted = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${BOOKKEEPING_SCHEMA}"."${BOOKKEEPING_TABLE}"`,
  )
  return Number(counted.rows[0]?.count ?? '0') > 0
}

/**
 * Record the baseline as applied without running a line of it.
 *
 * `created_at` is the baseline's own `folderMillis`, which is what Drizzle's
 * migrator compares against: it runs everything whose folder timestamp is
 * strictly greater than the newest one recorded. Written as the same
 * timestamp rather than as "now" so the baseline is exactly not-pending, and
 * so two adopted databases carry the same row.
 *
 * Only the baseline is stamped. Anything after it describes a change this
 * database has not had, and running those is the entire point of adopting.
 */
async function adopt(client: pg.PoolClient): Promise<void> {
  const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  if (!baseline) throw new Error('there is no baseline migration to adopt against')

  await client.query(`CREATE SCHEMA IF NOT EXISTS "${BOOKKEEPING_SCHEMA}"`)
  // The same shape Drizzle's migrator creates. It runs `CREATE TABLE IF NOT
  // EXISTS` itself a moment later and finds this one already there.
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${BOOKKEEPING_SCHEMA}"."${BOOKKEEPING_TABLE}" (
       id SERIAL PRIMARY KEY,
       hash text NOT NULL,
       created_at bigint
     )`,
  )
  await client.query(
    `INSERT INTO "${BOOKKEEPING_SCHEMA}"."${BOOKKEEPING_TABLE}" (hash, created_at) VALUES ($1, $2)`,
    [baseline.hash, baseline.folderMillis],
  )
}

/**
 * Bring `pool`'s database to the schema in `schema.ts`, adopting it first if it
 * already has the baseline tables and has never been migrated.
 *
 * Takes a `pg.Pool` rather than a `Db`, for the reason `applySchema` already
 * took one: `Db` has no `exec`, because multi-statement SQL is wanted by schema
 * work and by nothing else, and schema work is per-dialect. This is the SQLite
 * driver's `openDatabase` prologue, on the other database.
 */
export async function migrateToLatest(pool: pg.Pool): Promise<MigrationOutcome> {
  const client = await pool.connect()
  let outcome: MigrationOutcome = 'migrated'
  try {
    await client.query('SELECT pg_advisory_lock(CAST($1 AS bigint))', [MIGRATION_LOCK.toString()])

    if (!(await everMigrated(client))) {
      const baseline = baselineTables()
      const live = await liveTables(client, [...baseline.keys()])

      if (live.size === 0) {
        outcome = 'created'
      } else {
        const disagreements = differences(baseline, live)
        if (disagreements.length) {
          throw new Error(
            'this database has some of the catalogue tables but not the schema the ' +
            `baseline migration describes, so it cannot be adopted: ${disagreements.join('; ')}`,
          )
        }
        await adopt(client)
        outcome = 'adopted'
      }
    }

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
    return outcome
  } finally {
    await client.query('SELECT pg_advisory_unlock(CAST($1 AS bigint))', [MIGRATION_LOCK.toString()])
      .catch(() => undefined)
    client.release()
  }
}
