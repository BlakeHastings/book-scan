/**
 * The migration that turns `is_fiction` into tags, run on a database in the
 * state the owner's catalogue is actually in.
 *
 * That state is specific and it is why this file exists rather than a paragraph
 * in a pull request: the live catalogue was built by `applySchema` during stage
 * H and has never had a migration recorded against it, so a run there **adopts**
 * the baseline and then applies the two migrations after it. That is exactly what
 * is done below, on a database seeded here, and the counts asserted are the ones
 * a real run would report.
 *
 * Nothing in this file, or in the migration it exercises, connects to anything
 * but a scratch database this test made.
 */

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await dropScratchDatabases()
})

interface Seed {
  title: string
  isFiction: boolean
  source: string
  confidence: string
  scannedAt?: string
}

/**
 * A database with the pre-Drizzle schema and some books in it.
 *
 * `SCHEMA` rather than `applySchema`, which since #172 runs the migrations
 * itself and would therefore hand back a database that had already had this
 * one. `SCHEMA` is the fixed point the baseline is proved against, and it is
 * what stage H left on the live catalogue.
 */
async function catalogueOf(books: Seed[]): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await pool.query(SCHEMA)
  if (!books.length) return pool

  // One statement however many books. A round trip per row is what this was,
  // and against a container shared by a dozen test files that is enough to blow
  // through vitest's five second default: the 236 book case timed out here
  // twice while #180 was being written, with nothing wrong but the queue.
  await pool.query(
    `INSERT INTO books (title, shelf_range, is_fiction, classification_source,
                        classification_confidence, sort_key, scanned_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[],
                          $6::text[], $7::text[])`,
    [
      books.map((book) => book.title),
      books.map((book) => (book.isFiction ? 'fiction' : 'nonfiction')),
      books.map((book) => (book.isFiction ? 1 : 0)),
      books.map((book) => book.source),
      books.map((book) => book.confidence),
      books.map((_, at) => `key-${String(at).padStart(4, '0')}`),
      books.map((book) => book.scannedAt ?? '2026-01-02T03:04:05.000Z'),
    ],
  )
  return pool
}

/** Every tag every book carries, as `title genre source confidence`. */
async function tagsOf(pool: pg.Pool): Promise<string[]> {
  const rows = await pool.query<{ line: string }>(
    `SELECT b.title || ' ' || t.slug || ' ' || bt.source || ' ' || bt.confidence AS line
       FROM book_tag bt
       JOIN books b ON b.id = bt.book_id
       JOIN tag t ON t.id = bt.tag_id
      ORDER BY b.title, t.slug, bt.source`,
  )
  return rows.rows.map((row) => row.line)
}

describe('the fiction flag becoming tags', () => {
  it('carries the provenance it was decided with, book by book', async () => {
    const pool = await catalogueOf([
      { title: 'Decided by a person', isFiction: true, source: 'manual', confidence: 'high' },
      { title: 'Guessed', isFiction: true, source: 'auto', confidence: 'medium' },
      { title: 'Guessed badly', isFiction: false, source: 'auto', confidence: 'unknown' },
      { title: 'Corrected to non-fiction', isFiction: false, source: 'manual', confidence: 'weak' },
    ])

    // Adopted, because this database has the baseline tables and has never been
    // migrated. That is the path the real catalogue would take.
    expect(await migrateToLatest(pool)).toBe('adopted')

    expect(await tagsOf(pool)).toEqual([
      'Corrected to non-fiction genre/non-fiction person weak',
      'Decided by a person genre/fiction person high',
      'Guessed genre/fiction guess medium',
      'Guessed badly genre/non-fiction guess unknown',
    ])
  })

  it('gives every book exactly one genre tag', async () => {
    // Both tags exist in the vocabulary from the first run, so "the tag is
    // there" and "the book carries it" are different questions and the second
    // one is the one that matters.
    const pool = await catalogueOf(
      Array.from({ length: 236 }, (_, at) => ({
        title: `Book ${String(at).padStart(3, '0')}`,
        isFiction: at % 3 !== 0,
        source: at % 5 === 0 ? 'manual' : 'auto',
        confidence: 'medium',
      })),
    )

    await migrateToLatest(pool)

    const counted = await pool.query<{ books: string; tagged: string; person: string; guess: string }>(
      `SELECT (SELECT count(*) FROM books)::text AS books,
              (SELECT count(DISTINCT book_id) FROM book_tag)::text AS tagged,
              (SELECT count(*) FROM book_tag WHERE source = 'person')::text AS person,
              (SELECT count(*) FROM book_tag WHERE source = 'guess')::text AS guess`,
    )
    // 236 books, 236 tags, one each: 48 whose flag a person set, 188 guessed.
    expect(counted.rows[0]).toEqual({
      books: '236', tagged: '236', person: '48', guess: '188',
    })
  })

  it('leaves the columns it came from exactly as they were', async () => {
    // Nothing is dropped by *this* migration, and a run that lost a column
    // would be a run that reordered somebody's shelves. `books.is_fiction` is
    // no longer among them: `0018` drops it, four migrations after this one,
    // once nothing decides anything by it. `shelf_range` is what a shelf is
    // drawn from and is what this has to leave alone.
    const pool = await catalogueOf([
      { title: 'Dune', isFiction: true, source: 'manual', confidence: 'high' },
    ])
    await migrateToLatest(pool)

    const row = await pool.query<{
      shelf_range: string; classification_source: string; classification_confidence: string
    }>('SELECT shelf_range, classification_source, classification_confidence FROM books')
    expect(row.rows[0]).toEqual({
      shelf_range: 'fiction',
      classification_source: 'manual',
      classification_confidence: 'high',
    })
  })

  it('dates the tag from when the book was scanned, not from when it ran', async () => {
    const pool = await catalogueOf([
      { title: 'Dune', isFiction: true, source: 'auto', confidence: 'high', scannedAt: '2024-05-06T07:08:09.000Z' },
      { title: 'Nameless', isFiction: true, source: 'auto', confidence: 'high', scannedAt: '' },
    ])
    await migrateToLatest(pool)

    const rows = await pool.query<{ added_at: string }>(
      'SELECT added_at FROM book_tag JOIN books ON books.id = book_tag.book_id ORDER BY title',
    )
    expect(rows.rows.map((row) => row.added_at))
      .toEqual(['2024-05-06T07:08:09.000Z', '1970-01-01T00:00:00.000Z'])
  })

  it('is not run twice on a database that has already had it', async () => {
    const pool = await catalogueOf([
      { title: 'Dune', isFiction: true, source: 'manual', confidence: 'high' },
    ])
    await migrateToLatest(pool)
    const after = await tagsOf(pool)

    expect(await migrateToLatest(pool)).toBe('migrated')
    expect(await tagsOf(pool)).toEqual(after)
  })

  it('says nothing about a catalogue with no books in it', async () => {
    const pool = await catalogueOf([])
    await migrateToLatest(pool)

    // The vocabulary is still seeded: the two tags exist whether or not anything
    // carries them, so somebody can put a book under one by hand on day one.
    const vocabulary = await pool.query<{ slug: string; label: string }>(
      'SELECT slug, label FROM tag ORDER BY slug',
    )
    expect(vocabulary.rows).toEqual([
      { slug: 'genre/fiction', label: 'Fiction' },
      { slug: 'genre/non-fiction', label: 'Non-fiction' },
    ])
    expect(await tagsOf(pool)).toEqual([])
  })
})
