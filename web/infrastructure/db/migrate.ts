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
 *
 * ## And what happens when one of them will not finish
 *
 * See `MigrationFailed`. A migration that refuses says why, and until #199 the
 * saying went nowhere: what reached the terminal was Drizzle's `Failed query:`
 * and the whole statement, with the raised sentence one property deeper than
 * anywhere a person looks.
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
 * A migration that would not finish, said in the order a person reads.
 *
 * `applySchema` runs at startup, so the audience for this is somebody whose
 * server has just refused to come up in front of a catalogue that is somebody's
 * real book collection, deciding in the next minute whether to roll back. The
 * sentence the migration raised is the whole of what they can act on:
 * `0006_photographs_become_capture_rows.sql` goes to the trouble of naming the
 * individual photographs it could not account for.
 *
 * None of it used to reach them. Drizzle wraps everything its session throws in
 * an error whose entire message is `Failed query:` and then the statement, and
 * for the guard at the end of `0006` that is around a hundred and fifty lines
 * with the answer nowhere in it. The answer was on `.cause.message`.
 *
 * So the cause chain is read and its **messages** are the message here.
 *
 * ### Where the statement went, and why
 *
 * Onto `statement`, **not enumerable on purpose**. `console.error` prints an
 * error's own enumerable properties, so a statement left as an ordinary field
 * is printed in full underneath the summary, and a hundred and fifty lines
 * underneath the answer scrolls the answer off a terminal just as effectively
 * as putting it on top did. It is one property lookup away for whoever wants it,
 * and the message says so rather than leaving it to be discovered.
 *
 * Nothing is swallowed. `cause` is the error postgres raised, with its SQLSTATE,
 * its `where`, its `constraint` and its own stack, and `console.error` prints
 * that whole object under `[cause]` because Node inspects `cause` whether it is
 * enumerable or not. What is dropped from the chain is only the link whose
 * message restates its own `query`, which is to say the link that says nothing
 * the next one does not.
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
 * Every error in `error`'s cause chain, outermost first.
 *
 * Bounded and cycle-checked because this runs while something has already gone
 * wrong, and a formatter that hangs on a self-referential `cause` would replace
 * a migration failure with a worse one.
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
 * The statement a link is blaming, when the link's message is that statement.
 *
 * Duck typed, and on the relationship between the two rather than on the words
 * `Failed query`. What makes this link worth passing over is not that Drizzle
 * threw it: it is that its message restates its own `query`, so it carries no
 * sentence the next link down does not. A link that merely *mentions* a query
 * keeps its message.
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
 * Which file a failing statement came from, so the reader opens one rather than
 * seven.
 *
 * The journal is read for the names, which `readMigrationFiles` does not return,
 * and the two are index-aligned because it builds its list by walking the same
 * journal in the same order.
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
 * Turn whatever the migrator threw into something worth reading.
 *
 * General on purpose. A `RAISE EXCEPTION` from a guard, a constraint violation,
 * a lock timeout, a syntax error and a connection that never opened all arrive
 * differently, and none of them is recognised here by its wording: the chain is
 * walked, the messages in it are printed, and anything that turns out to be a
 * restated query becomes the statement instead.
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

    // Only the migrator's own failures are reworded. The refusals above are
    // this file's sentences already, and wrapping them would put a second
    // heading on a message that reads fine.
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
