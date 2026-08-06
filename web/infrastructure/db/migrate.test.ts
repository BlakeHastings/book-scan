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
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, describe, expect, inject, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'

/**
 * Created with a linguistic collation, exactly as `server/testdb.ts` does it.
 * A byte order database would make every `COLLATE "C"` comparison below vacuous
 * by ordering correctly whatever the column said.
 */
const HOSTILE_COLLATIONS = ['en_US.utf8', 'en_US.UTF-8', 'en-US-x-icu']

const serverUrl = () => process.env.BOOKSCAN_TEST_DATABASE_URL ?? inject('postgresUrl')

const opened: { pool: pg.Pool; name: string }[] = []

function poolFor(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString })
  // node-postgres throws on an `error` event with no listener, which surfaces
  // as this file failing with every test in it passing. See PgDb.
  pool.on('error', () => {})
  return pool
}

/** An empty database of its own, dropped when the file finishes. */
async function scratch(): Promise<pg.Pool> {
  const server = serverUrl()
  const name = `bookscan_migrate_${randomBytes(6).toString('hex')}`

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
  opened.push({ pool, name })
  return pool
}

afterAll(async () => {
  for (const { pool, name } of opened.splice(0)) {
    await pool.end().catch(() => undefined)
    const admin = poolFor(serverUrl())
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name}`)
    } catch {
      // A scratch database left behind is not worth failing a green run over.
    } finally {
      await admin.end()
    }
  }
})

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

    expect(await migrateToLatest(migrated)).toBe('created')
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

  it('keeps COLLATE "C" on the four columns that decide shelf order', async () => {
    // Asserted separately from the diff above, and not because the diff misses
    // it. If both sides ever lost the collation together the diff would still
    // be green, and a shelf would quietly reorder. See SORT_KEY_COLUMNS.
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
    ])
  })

  it('records the baseline, so a second run does nothing', async () => {
    const pool = await scratch()
    expect(await migrateToLatest(pool)).toBe('created')
    const after = await describeSchema(pool)

    expect(await migrateToLatest(pool)).toBe('migrated')
    expect(await describeSchema(pool)).toEqual(after)
    expect(await recorded(pool)).toHaveLength(1)
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
    // Nothing ran. The schema is the one that was already there, and it is now
    // under migration control: the baseline is recorded as applied.
    expect(await describeSchema(pool)).toEqual(before)
    expect(await recorded(pool)).toHaveLength(1)
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
