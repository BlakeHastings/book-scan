/**
 * The baseline migration, against a real Postgres.
 *
 * Two claims are made in the pull request that introduced this file, and
 * neither of them is worth anything unless a machine checks it:
 *
 * 1. **The baseline produces the schema the app produces today.** Not
 *    approximately: the same columns in the same order with the same types,
 *    defaults, nullability and collations, the same indexes, the same
 *    constraints under the same names, and the same identity sequences. Both
 *    databases are built here and diffed, so "faithful transcription" is a test
 *    result rather than a claim about having read carefully.
 *
 * 2. **A database that already has this schema is adopted, not rebuilt.** That
 *    is the case that actually happens: the Postgres container has a persistent
 *    volume per checkout, so every developer already has a database full of
 *    tables the migrator has never seen. The rows are still there afterwards,
 *    which is asserted with a book in the table rather than inferred.
 *
 * Postgres only, and it has to be: every question here is about what a Postgres
 * catalogue says about itself.
 *
 * **Since #179 the baseline is not the only migration**, so claim 1 is asked of
 * the baseline on its own, applied by `applyBaseline` below. Running the folder
 * and diffing against `SCHEMA` would now compare the schema the app is moving
 * towards against the schema it came from and report every deliberate change as
 * a failure.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { MigrationFailed, migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

/**
 * An empty database of its own, dropped when the file finishes.
 *
 * The making and dropping moved to `testdb.ts` when #179 added two more files
 * that need the same thing. It is the same database this file always made,
 * created with a linguistic collation on purpose: a byte ordered one would make
 * every `COLLATE "C"` comparison below vacuous by ordering correctly whatever
 * the column said.
 */
const scratch = scratchDatabase

afterAll(async () => {
  await dropScratchDatabases()
  // Four or five databases, each with a connection of its own to open and a
  // DROP to wait for, and vitest's default hook timeout is ten seconds. That
  // is enough against the service container CI uses and not always enough
  // against a container on a laptop, where this file failed with every test
  // in it passing.
}, 60_000)

/**
 * Everything about the shape of a database that anything depends on.
 *
 * Deliberately read out of the catalogue rather than compared as SQL text. The
 * two schemas are written in different languages by different tools, and what
 * has to match is what Postgres ended up with.
 *
 * `public` only, so Drizzle's own `drizzle.__drizzle_migrations` bookkeeping is
 * out of scope: it is the migrator's, not the catalogue's.
 */
async function describeSchema(pool: pg.Pool) {
  const columns = await pool.query(
    `SELECT table_name, ordinal_position, column_name, data_type, is_nullable,
            column_default, collation_name, is_identity, identity_generation
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  )
  const indexes = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY indexname`,
  )
  const constraints = await pool.query(
    `SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY c.conname`,
  )
  const sequences = await pool.query(
    `SELECT sequencename, data_type, start_value, min_value, max_value,
            increment_by, cycle, cache_size
       FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
  )

  return {
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    sequences: sequences.rows,
  }
}

/**
 * The baseline, run on its own.
 *
 * There are migrations after it now, so `migrateToLatest` no longer answers the
 * question this file's first claim is about: the baseline is a transcription of
 * `SCHEMA`, and everything after it is a change to that schema on purpose. So
 * the baseline is applied by hand here, statement by statement, exactly as
 * Drizzle's migrator would. **This is the only place that does that**, and it is
 * why the migration folder is read rather than the file named.
 */
async function applyBaseline(pool: pg.Pool): Promise<void> {
  const path = fileURLToPath(new URL('./migrations/0000_baseline.sql', import.meta.url))
  for (const statement of readFileSync(path, 'utf8').split('--> statement-breakpoint')) {
    if (statement.trim()) await pool.query(statement)
  }
}

/** How many migration files there are, which is how many rows get recorded. */
function migrationCount(): number {
  const path = fileURLToPath(new URL('./migrations/meta/_journal.json', import.meta.url))
  return (JSON.parse(readFileSync(path, 'utf8')) as { entries: unknown[] }).entries.length
}

/** The tables the baseline creates, read from its own snapshot. */
function baselineTableNames(): string[] {
  const path = fileURLToPath(new URL('./migrations/meta/0000_snapshot.json', import.meta.url))
  const snapshot = JSON.parse(readFileSync(path, 'utf8')) as {
    tables: Record<string, { name: string }>
  }
  return Object.values(snapshot.tables).map((table) => table.name)
}

/** Every table in a database, which is how a later migration shows up. */
async function tablesIn(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  )
  return result.rows.map((row) => row.table_name)
}

/** The bookkeeping rows Drizzle keeps, or an empty list when it keeps none. */
async function recorded(pool: pg.Pool) {
  const result = await pool.query<{ hash: string; created_at: string }>(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
  )
  return result.rows
}

describe('the baseline migration on an empty database', () => {
  it('produces the schema this app produced before Drizzle', async () => {
    const migrated = await scratch()
    const asShipped = await scratch()

    await applyBaseline(migrated)
    await asShipped.query(SCHEMA)

    const fromMigration = await describeSchema(migrated)
    const fromCode = await describeSchema(asShipped)

    // Named one at a time rather than as a single object, because a failure
    // that says "objects differ" over four hundred columns tells nobody which
    // column moved.
    expect(fromMigration.columns).toEqual(fromCode.columns)
    expect(fromMigration.indexes).toEqual(fromCode.indexes)
    expect(fromMigration.constraints).toEqual(fromCode.constraints)
    expect(fromMigration.sequences).toEqual(fromCode.sequences)
  })

  it('keeps COLLATE "C" on every column whose byte order is load bearing', async () => {
    // Asserted separately from the diff above, and not because the diff misses
    // it. If both sides ever lost the collation together the diff would still
    // be green, and a shelf would quietly reorder. See SORT_KEY_COLUMNS.
    //
    // Four of these decide shelf order. `tag.slug` is the fifth and is here for
    // a different reason: a prefix range over it is how "everything under
    // genre" is answered, and on a linguistic collation that range is neither
    // an index seek nor dependably the right rows.
    //
    // `author_alias.filing_name` is the sixth, added by #180. It is a filing
    // name, so it is the same kind of column as `books.author_filing`: the first
    // component of a sort key today and the second tiebreak of every sort
    // strategy in docs/data-model.md that is not `author`. Nothing orders by it
    // yet, and it carries the collation now because adding it once a shelf is
    // ordered by the column means rewriting the column that decides the order.
    //
    // The last three are `shelved_books`, added by #183, and they are the reason
    // this query is not filtered to tables. A view column takes the type, and so
    // the collation, of the expression behind it, and that view is what every
    // ordering query reads from now on. If it ever came back uncollated the shelf
    // would reorder under a linguistic collation exactly as it would have done
    // before any of this existed, silently, and nothing else here would notice.
    const migrated = await scratch()
    await migrateToLatest(migrated)

    const collated = await migrated.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND collation_name = 'C'
        ORDER BY table_name, column_name`,
    )
    expect(collated.rows).toEqual([
      { table_name: 'author_alias', column_name: 'filing_name' },
      { table_name: 'books', column_name: 'author_filing' },
      { table_name: 'books', column_name: 'sort_key' },
      { table_name: 'books', column_name: 'title_filing' },
      { table_name: 'separators', column_name: 'starts_at' },
      { table_name: 'shelved_books', column_name: 'author_filing' },
      { table_name: 'shelved_books', column_name: 'sort_key' },
      { table_name: 'shelved_books', column_name: 'title_filing' },
      { table_name: 'tag', column_name: 'slug' },
    ])
  })

  it('records every migration, so a second run does nothing', async () => {
    const pool = await scratch()
    expect(await migrateToLatest(pool)).toBe('created')
    const after = await describeSchema(pool)
    const applied = await recorded(pool)

    expect(await migrateToLatest(pool)).toBe('migrated')
    expect(await describeSchema(pool)).toEqual(after)
    // One row per file in the folder, and the same rows as a moment ago.
    expect(await recorded(pool)).toEqual(applied)
    expect(applied).toHaveLength(migrationCount())
  })
})

describe('a database that already has these tables', () => {
  it('is adopted rather than rebuilt, and keeps its rows', async () => {
    const pool = await scratch()
    await pool.query(SCHEMA)
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at)
       VALUES ('A book somebody scanned', 'fiction', 1, 'k', '2026-08-06')`,
    )
    const before = await describeSchema(pool)

    expect(await migrateToLatest(pool)).toBe('adopted')

    const survivors = await pool.query<{ title: string }>('SELECT title FROM books')
    expect(survivors.rows.map((row) => row.title)).toEqual(['A book somebody scanned'])

    // The baseline did not run: every column it would have created is exactly
    // as it was, on a database that already had rows in it.
    //
    // Not "the tables are untouched", which is what this used to say and what
    // stopped being true at #183. `0007` adds `books.state`, the first migration
    // to alter a table the baseline created rather than add one beside it, so
    // the claim worth making is that a later migration's deliberate addition is
    // the *only* difference. A baseline that had run would show up as every
    // column being rebuilt, which this still catches.
    const after = await describeSchema(pool)
    const baseline = baselineTableNames()
    const ofBaseline = (rows: Record<string, unknown>[]) =>
      rows.filter((row) => baseline.includes(String(row.table_name)))
    const named = (row: Record<string, unknown>) => `${row.table_name}.${row.column_name}`
    const was = new Set(ofBaseline(before.columns).map(named))

    expect(ofBaseline(after.columns).filter((row) => !was.has(named(row))).map(named))
      .toEqual(['books.state'])
    expect(ofBaseline(after.columns).filter((row) => was.has(named(row))))
      .toEqual(ofBaseline(before.columns))

    // What did run is everything after the baseline, which is the point of
    // adopting: this database has now had the migrations it had not had.
    expect(await tablesIn(pool)).toContain('book_tag')
    expect(await recorded(pool)).toHaveLength(migrationCount())
  })

  it('is indistinguishable afterwards from one the baseline built', async () => {
    const adopted = await scratch()
    await adopted.query(SCHEMA)
    await migrateToLatest(adopted)

    const created = await scratch()
    await migrateToLatest(created)

    // The point of adopting: from here the two databases take the same
    // migrations in the same order, because they agree on what has run.
    expect(await recorded(adopted)).toEqual(await recorded(created))
    expect(await migrateToLatest(adopted)).toBe('migrated')
  })
})

describe('a database that is neither empty nor this schema', () => {
  it('is refused, and the missing column is named', async () => {
    const pool = await scratch()
    await pool.query(SCHEMA)
    await pool.query('ALTER TABLE separators DROP COLUMN note')

    await expect(migrateToLatest(pool)).rejects.toThrow(/separators has no note/)
    // Refused before anything was written, so it can be looked at.
    expect(await recorded(pool).catch(() => 'no bookkeeping')).toBe('no bookkeeping')
  })

  it('is refused when only some of the tables are there', async () => {
    const pool = await scratch()
    await pool.query('CREATE TABLE books (id integer)')

    await expect(migrateToLatest(pool)).rejects.toThrow(/captures is missing/)
  })
})

/**
 * What a person sees when a migration will not finish (#199).
 *
 * These assert on the whole shape of the message rather than only that the
 * reason appears somewhere in it, and that is the point. Before this, the
 * reason **did** appear somewhere in it: Drizzle's message is the failing
 * statement, and the statement contains the `RAISE EXCEPTION` line, so a test
 * matching `/would have lost a crop/` passed against a message that was the SQL
 * source of the sentence rather than the sentence. So each case here also says
 * what must **not** be in the message.
 *
 * Two kinds of failure, deliberately. One is raised on purpose by a guard, and
 * one is an ordinary Postgres error that nothing in this repository wrote. They
 * arrive through different paths, and a fix that only reads well for the one
 * that was tested is worse than none, because it looks solved.
 */
describe('a migration that will not finish', () => {
  async function refusalFrom(pool: pg.Pool): Promise<MigrationFailed> {
    const caught = await migrateToLatest(pool).then(() => undefined, (error: unknown) => error)
    expect(caught).toBeInstanceOf(MigrationFailed)
    return caught as MigrationFailed
  }

  it('says the sentence the guard raised, and not the statement that raised it', async () => {
    const pool = await scratch()
    await pool.query(SCHEMA)
    // A crop naming a file no photograph does. `0006` refuses rather than
    // losing it; see capture-backfill.test.ts for what that guard is for.
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at,
                          front_image, front_crop)
       VALUES ('A crop with no photograph', 'fiction', 1, 'k', '2026-08-06', '', 'orphan.jpg')`,
    )

    const refusal = await refusalFrom(pool)

    expect(refusal.message).toContain(
      'the capture migration would have lost a crop: books name 1 of them and 0 capture rows carry one',
    )
    expect(refusal.message).toContain('SQLSTATE P0001')
    // Which file to open, so the answer to "and now what" is one file rather
    // than the whole folder.
    expect(refusal.message).toContain('0006_photographs_become_capture_rows.sql')

    // Not the statement. This is the assertion the old test could not make.
    expect(refusal.message).not.toContain('DO $$')
    expect(refusal.message).not.toContain('RAISE EXCEPTION')
    expect(refusal.message.split('\n')).toHaveLength(3)

    // Kept, though, and reachable without a debugger.
    expect(refusal.statement).toContain('RAISE EXCEPTION')

    // And kept out of what a terminal prints, which is what being
    // non-enumerable buys. `console.error` inspects an error this way.
    expect(inspect(refusal, { depth: 5 })).not.toContain('DO $$')

    // The error postgres raised, not swallowed: its SQLSTATE, its `where` and
    // its own stack are all still there for whoever needs them.
    const cause = refusal.cause as { code?: string; where?: string; stack?: string }
    expect(cause.code).toBe('P0001')
    expect(cause.where).toContain('at RAISE')
    // Its own stack, not one captured while formatting: these are the frames
    // that were on the way in when postgres answered.
    expect(cause.stack).toContain('migrateToLatest')
  })

  it('says as much for a failure nothing raised on purpose', async () => {
    const pool = await scratch()
    await pool.query(SCHEMA)
    // Something already sitting where a migration is about to create a table.
    // A plain Postgres error, with no `RAISE` anywhere near it.
    await pool.query('CREATE TABLE "tag" (id integer)')

    const refusal = await refusalFrom(pool)

    expect(refusal.message).toContain('relation "tag" already exists')
    expect(refusal.message).toContain('SQLSTATE 42P07')
    expect(refusal.message).toContain('0001_tags.sql')
    expect(refusal.message).not.toContain('CREATE TABLE')
    expect(refusal.statement).toContain('CREATE TABLE "tag"')
    expect((refusal.cause as { code?: string }).code).toBe('42P07')
  })

  it('leaves the schema where it was, which is what the message claims', async () => {
    // The message says no migration was applied. Nothing else here checks that,
    // and it is the sentence somebody deciding whether to roll back reads.
    const pool = await scratch()
    await pool.query(SCHEMA)
    await pool.query('CREATE TABLE "tag" (id integer)')

    const refusal = await refusalFrom(pool)
    expect(refusal.message).toContain('no migration was applied')

    // `book_tag` is the first thing 0001 creates, and the failure is the
    // statement after it. The migrator runs the pending migrations in one
    // transaction, so it went back.
    const applied = await pool.query<{ table: string | null }>(
      "SELECT to_regclass('public.book_tag')::text AS table",
    )
    expect(applied.rows[0]?.table).toBeNull()
  })
})
