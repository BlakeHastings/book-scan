/**
 * `chooseDividerTable` in `server/backup.ts` asks the catalogue what
 * divider table it has rather than assuming one, the way
 * `CATALOGUE_TABLES_SQL` already asks it for the table list. This file
 * proves both shapes read with nothing thrown: a catalogue built from
 * migrations before `area` exists at all, and one built to the schema
 * master has today.
 *
 * Nothing here reads, writes or connects to anything under
 * book-scan-production-data or 127.0.0.1:5433. Every database is a
 * scratch one this file makes, on the container the run started, swept
 * after the last test in the run by `server/pgcontainer.ts`.
 */

import pg from 'pg'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { readDigest, type Queryable } from '../../server/backup'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
import { closeScratchDatabases, migrationsThrough, scratchDatabase } from './testdb'

const openHere: pg.Pool[] = []

afterEach(async () => {
  await Promise.all(openHere.splice(0).map((pool) => pool.end().catch(() => undefined)))
})

afterAll(closeScratchDatabases)

function asQueryable(pool: pg.Pool): Queryable {
  return { query: (sql: string) => pool.query(sql) }
}

describe('the schema before #232 (and before #216, before area exists at all)', () => {
  /**
   * `0011_the_queue_becomes_books` is the last migration before
   * `0012_the_furniture_becomes_rows` creates `area`. A catalogue stopped
   * there has `separators` as the only boundary table there is.
   */
  it('reads the divider order from separators, with no area table to fall back on', async () => {
    const pool = await scratchDatabase()
    openHere.push(pool)
    await pool.query(SCHEMA)
    await migrationsThrough(pool, '0011_the_queue_becomes_books')

    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at) VALUES
         ('Alpha', 'fiction', 1, 'alpha', '2026-01-01T00:00:00Z'),
         ('Beta',  'fiction', 1, 'beta',  '2026-01-01T00:00:00Z')`,
    )
    await pool.query(
      `INSERT INTO separators (shelf_range, kind, starts_at, position, created_at) VALUES
         ('fiction', 'area', 'beta', 1, '2026-01-01T00:00:00Z')`,
    )

    const tableNames = (await pool.query<{ name: string }>(
      "select relname as name from pg_class where relkind = 'r' and relname = 'area'",
    )).rows
    expect(tableNames).toEqual([])

    const digest = await readDigest(asQueryable(pool))

    expect(digest.dividerTable).toBe('separators')
    expect(digest.tables).toContain('separators')
    expect(digest.tables).not.toContain('area')
    expect(digest.shelfOrder).not.toBeNull()
    expect(digest.areaOrder).not.toBeNull()
  })
})

describe('the schema since #232, which master has today', () => {
  it('reads the divider order from area, which is what separators became', async () => {
    const pool = await scratchDatabase()
    openHere.push(pool)
    await migrateToLatest(pool)

    await pool.query(
      `INSERT INTO books (title, shelf_range, sort_key, title_filing, scanned_at) VALUES
         ('Alpha', 'fiction', 'alpha', 'alpha', '2026-01-01T00:00:00Z'),
         ('Beta',  'fiction', 'beta',  'beta',  '2026-01-01T00:00:00Z')`,
    )

    const digest = await readDigest(asQueryable(pool))

    expect(digest.dividerTable).toBe('area')
    expect(digest.tables).toContain('area')
    expect(digest.tables).not.toContain('separators')
    expect(digest.shelfOrder).not.toBeNull()
    expect(digest.areaOrder).not.toBeNull()
  })
})
