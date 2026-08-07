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
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
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
    const migrated = await scratch()
    await migrateToLatest(migrated)

    const collated = await migrated.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND collation_name = 'C'
        ORDER BY table_name, column_name`,
    )
    expect(collated.rows).toEqual([
      { table_name: 'books', column_name: 'author_filing' },
      { table_name: 'books', column_name: 'sort_key' },
      { table_name: 'books', column_name: 'title_filing' },
      { table_name: 'separators', column_name: 'starts_at' },
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

    // The baseline did not run: every table it would have created is exactly as
    // it was, column for column, on a database that already had rows in it.
    const after = await describeSchema(pool)
    const baseline = baselineTableNames()
    const ofBaseline = (rows: Record<string, unknown>[]) =>
      rows.filter((row) => baseline.includes(String(row.table_name)))
    expect(ofBaseline(after.columns)).toEqual(ofBaseline(before.columns))

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
