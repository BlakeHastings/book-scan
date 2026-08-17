/**
 * #240, proved against both schemas rather than only against the one master
 * happens to have.
 *
 * `readDigest` used to read `area` unconditionally, because that is the
 * schema master has had since #232. Against a catalogue that had not been
 * migrated that far it died with `relation "area" does not exist`, and it did
 * so after `backup-catalogue.ts` had already printed the dump's filename: the
 * one line left in the log said a backup had been taken, and none had.
 *
 * `chooseDividerTable` in `server/backup.ts` asks the catalogue instead of
 * assuming, the way `CATALOGUE_TABLES_SQL` already asks it for the table
 * list (#216). This file is the proof the issue asks for: one catalogue built
 * from migrations to the exact shape the error trace names, `area` not
 * existing at all, and one built to the schema master has today, both read
 * with nothing thrown.
 *
 * Nothing here reads, writes or connects to anything under
 * book-scan-production-data or 127.0.0.1:5433. Every database is a scratch
 * one this file makes, on the container the run started, swept after the last
 * test in the run by `server/pgcontainer.ts`.
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
   * there is the literal shape of the error #240 reports: `separators` is
   * the only boundary table there is, exactly as it was on the day this
   * schema shipped, long before #232 gave it a rival and then dropped it.
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
