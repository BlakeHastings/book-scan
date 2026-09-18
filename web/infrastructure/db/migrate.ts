/**
 * Brings a Postgres database to the schema in `schema.ts`, whether it has
 * ever been migrated before or not.
 *
 * Drizzle's migrator assumes an empty database and would fail on one that
 * already has the baseline tables (the developer's Postgres container has a
 * persistent volume per checkout, so the tables are already there). A
 * database that already carries the baseline schema is adopted instead: the
 * baseline is recorded as applied without being run, and only migrations
 * after it run. A database with some but not all of the baseline tables is
 * refused rather than guessed at.
 *
 * See `MigrationFailed`: Drizzle wraps a migration failure's real cause in a
 * message that is just `Failed query:` and the statement, with the actual
 * reason nested on `.cause.message`.
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
 * database is empty. Session-scoped rather than transaction-scoped because the
 * work below spans several transactions; held on a client this function owns
 * and releases, per driver.ts's warning about session-scoped locks leaking.
 */
const MIGRATION_LOCK = 8_612_004_172n

export type MigrationOutcome = 'created' | 'adopted' | 'migrated'

/** What the baseline creates, as drizzle-kit recorded it when it generated. */
interface Snapshot {
  tables: Record<string, { name: string; columns: Record<string, { name: string }> }>
}

/**
 * The baseline's own snapshot, read rather than derived from `schema.ts`.
 * `schema.ts` describes the schema after every migration in the folder; the
 * snapshot beside `0000_baseline.sql` describes only what the baseline
 * leaves, which is what adoption must check against.
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
 * Whether this database is the one the baseline would have built: column
 * names and order per table, nothing else. Types, defaults, collations and
 * indexes are compared by `migrate.test.ts` instead, which can build both
 * databases and diff them properly; doing it here would ship a schema differ
 * into the startup path.
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
 * Record the baseline as applied without running a line of it. `created_at`
 * is stamped as the baseline's own `folderMillis`, the value Drizzle's
 * migrator compares against to decide what is still pending. Only the
 * baseline is stamped; anything after it is what adoption exists to run.
 */
async function adopt(client: pg.PoolClient): Promise<void> {
  const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  if (!baseline) throw new Error('there is no baseline migration to adopt against')

  await client.query(`CREATE SCHEMA IF NOT EXISTS "${BOOKKEEPING_SCHEMA}"`)
  // Same shape Drizzle's migrator creates; it runs `CREATE TABLE IF NOT
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
 * A migration that would not finish, said in the order a person reads.
 *
 * Drizzle wraps everything its session throws in an error whose message is
 * just `Failed query:` and the statement, with the real reason nested on
 * `.cause.message`. This walks the cause chain and uses its messages instead,
 * dropping only a link whose message merely restates its own `query`.
 *
 * `statement` is deliberately non-enumerable so `console.error` does not
 * print it (it can run to hundreds of lines) underneath the summary; it is
 * still one property lookup away.
 */
export class MigrationFailed extends Error {
  /** The statement that was running, when the chain said which. */
  declare readonly statement?: string

  constructor(message: string, options: { cause: unknown; statement?: string }) {
    super(message, { cause: options.cause })
    this.name = 'MigrationFailed'
    Object.defineProperty(this, 'statement', { value: options.statement, enumerable: false })
  }
}

/**
 * Every error in `error`'s cause chain, outermost first. Bounded and
 * cycle-checked so a self-referential `cause` cannot hang this while
 * something has already gone wrong.
 */
function causeChain(error: unknown): unknown[] {
  const links: unknown[] = []
  let link: unknown = error
  while (link !== undefined && link !== null && !links.includes(link) && links.length < 8) {
    links.push(link)
    link = (link as { cause?: unknown }).cause
  }
  return links
}

/** What a link says, whether or not whoever threw it threw an `Error`. */
function messageOf(link: unknown): string {
  return link instanceof Error ? link.message : String(link)
}

/**
 * The statement a link is blaming, when the link's message merely restates
 * that statement rather than adding anything. Matched by that relationship,
 * not by Drizzle's wording, so a link that only mentions a query keeps its
 * message.
 */
function restatedQuery(link: unknown): string | undefined {
  const query = (link as { query?: unknown }).query
  if (typeof query !== 'string' || !query.trim()) return undefined
  return messageOf(link).includes(query.trim()) ? query : undefined
}

/** A SQLSTATE, which is five characters, and not a `code` of any other kind. */
function sqlstate(link: unknown): string | undefined {
  const code = (link as { code?: unknown }).code
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined
}

/**
 * Which file a failing statement came from, so the reader opens one rather
 * than seven. The journal and `readMigrationFiles` are index-aligned because
 * both walk the same journal in the same order.
 */
function migrationNaming(statement: string): string | undefined {
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('./migrations/meta/_journal.json', import.meta.url)), 'utf8'),
  ) as { entries: { tag: string }[] }

  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  const at = files.findIndex((migration) => migration.sql.includes(statement))
  const tag = at < 0 ? undefined : journal.entries[at]?.tag
  return tag && `${tag}.sql`
}

/**
 * Turn whatever the migrator threw into something worth reading, by walking
 * the cause chain rather than recognising specific wording.
 */
function refusal(error: unknown): MigrationFailed {
  const links = causeChain(error)
  const statement = links.map(restatedQuery).find((query) => query !== undefined)
  const spoken = links.filter((link) => restatedQuery(link) === undefined)
  const cause = spoken[0] ?? error

  const said = spoken.map(messageOf).filter((message) => message !== '')
  const lines = [
    'a migration refused to finish, and no migration was applied: ' +
    (said[0] ?? 'the migrator gave no reason'),
  ]
  for (const also of said.slice(1)) lines.push(`  caused by: ${also}`)

  const code = sqlstate(cause)
  const file = statement === undefined ? undefined : migrationNaming(statement)
  const located = [code && `postgres SQLSTATE ${code}`, file && `in ${file}`]
    .filter((part): part is string => typeof part === 'string')
  if (located.length) lines.push(`  ${located.join(', ')}`)

  if (statement) {
    lines.push(
      `  the ${statement.trim().split('\n').length} line statement is on this error's ` +
      '`statement` property, deliberately not in this message',
    )
  }

  return new MigrationFailed(lines.join('\n'), { cause, statement })
}

/**
 * Bring `pool`'s database to the schema in `schema.ts`, adopting it first if
 * it already has the baseline tables and has never been migrated. Takes a
 * `pg.Pool` rather than a `Db` because `Db` has no `exec`; schema work needs
 * multi-statement SQL, which is per-dialect.
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

    // Only the migrator's own failures are reworded; the refusals above
    // already read fine.
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
    } catch (error) {
      throw refusal(error)
    }
    return outcome
  } finally {
    await client.query('SELECT pg_advisory_unlock(CAST($1 AS bigint))', [MIGRATION_LOCK.toString()])
      .catch(() => undefined)
    client.release()
  }
}
