/**
 * The migration that dissolves the `captures` queue table into `books`,
 * run on a database in the state the owner's catalogue is in: built by
 * `applySchema` and never migrated, so a run here adopts the baseline and
 * then applies everything after it.
 *
 * Four claims are checked by a machine:
 *
 * 1. Every queue row becomes a book, in the state its status said it was
 *    in. A row left behind is a scan nothing can find.
 * 2. No book reaches a shelf. Every row this migration writes is in an
 *    early state, so the shelf order hash `docs/backup-runbook.md`
 *    compares restores with has to be the same string either side of it.
 * 3. The queue's three image columns become `capture` rows, which is the
 *    decision `0006` deferred here on purpose because a capture with no
 *    book had nowhere to hang its photographs.
 * 4. It is safe to run twice, because a queue row that already names its
 *    book is skipped.
 *
 * Nothing in this file, or in the migration it exercises, connects to
 * anything but a scratch database this test made.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
import { closeScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await closeScratchDatabases()
})

/** One row of the queue as stage H left it, in the queue's own vocabulary. */
interface Queued {
  status: 'pending' | 'ready' | 'failed' | 'done'
  front?: string
  back?: string
  edge?: string
  frontCrop?: string
  cropped?: string
  isbn13?: string
  claimedBy?: string
  note?: string
  /** Set only for a `done` row, which is a capture that became a book. */
  bookId?: number | null
}

/**
 * The shelf order hash, spelled exactly as `server/backup.ts` does: this is
 * the string a restore is verified against, so a migration that leaves it
 * alone leaves that check alone too.
 */
const SHELF_ORDER = "md5(string_agg(id::text, ',' order by sort_key, id))"

async function hashOf(pool: pg.Pool, relation: string): Promise<string | null> {
  const rows = await pool.query<{ hash: string | null }>(
    `SELECT ${SHELF_ORDER} AS hash FROM ${relation}`,
  )
  return rows.rows[0]?.hash ?? null
}

async function statesIn(pool: pg.Pool): Promise<Record<string, number>> {
  const rows = await pool.query<{ state: string; n: string }>(
    'SELECT state, count(*)::text AS n FROM books GROUP BY state ORDER BY state',
  )
  return Object.fromEntries(rows.rows.map((row) => [row.state, Number(row.n)]))
}

/**
 * A catalogue with books on a shelf and a queue beside it. Uses `SCHEMA`
 * rather than `applySchema`, which runs the migrations itself and would
 * hand back a database that had already had these.
 */
async function catalogueOf(shelved: number, queue: Queued[]): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await pool.query(SCHEMA)

  for (let at = 0; at < shelved; at += 1) {
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at,
                          front_image, cropped)
       VALUES ($1, 'fiction', 1, $2, '2026-01-02T03:04:05.000Z', $3, 'front')`,
      [`Book ${at}`, `key-${String(at).padStart(4, '0')}`, `book-${at}_front.jpg`],
    )
  }

  for (const row of queue) {
    await pool.query(
      `INSERT INTO captures
         (status, front_image, back_image, edge_image, front_crop, cropped,
          isbn13, claimed_by, note, book_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '2026-02-03T04:05:06.000Z')`,
      [
        row.status, row.front ?? '', row.back ?? '', row.edge ?? '',
        row.frontCrop ?? '', row.cropped ?? '', row.isbn13 ?? '',
        row.claimedBy ?? '', row.note ?? '', row.bookId ?? null,
      ],
    )
  }
  return pool
}

/** A queue with one row of every kind, which is what the migration has to sort. */
const ONE_OF_EACH: Queued[] = [
  { status: 'pending', front: 'p_front.jpg' },
  { status: 'failed', front: 'f_front.jpg', note: 'No ISBN could be read.' },
  { status: 'ready', front: 'r_front.jpg', isbn13: '9780441013593', claimedBy: 'alice' },
  // A capture that became a book. It already has one, so nothing is created.
  { status: 'done', front: 'book-0_front.jpg', bookId: 1 },
]

describe('the queue table dissolving into books', () => {
  it('gives every queue row a book, in the state its status said it was in', async () => {
    const pool = await catalogueOf(3, ONE_OF_EACH)
    await migrateToLatest(pool)

    expect(await statesIn(pool)).toEqual({
      shelved: 3,
      scanned: 1,
      unidentified: 1,
      identified: 1,
    })

    // Every row names the book it is, including the one that already was
    // one; that column is what makes a second run a no-op.
    const orphaned = await pool.query('SELECT id FROM captures WHERE book_id IS NULL')
    expect(orphaned.rowCount).toBe(0)
  }, 60_000)

  it('moves no book on any shelf, which is the whole claim', async () => {
    const pool = await catalogueOf(12, ONE_OF_EACH)
    const before = await hashOf(pool, 'books')
    await migrateToLatest(pool)

    // Taken over `books` before (no view existed yet and every row was on
    // a shelf) and over `shelved_books` after: four rows arrived in
    // `books` in between and none may show up here.
    expect(await hashOf(pool, 'shelved_books')).toBe(before)
    expect(before).not.toBeNull()
  }, 60_000)

  it('carries what the queue knew across, under the names books uses', async () => {
    const pool = await catalogueOf(1, [{
      status: 'failed',
      front: 'q_front.jpg', back: 'q_back.jpg', edge: 'q_edge.jpg',
      frontCrop: 'q_front_crop.jpg', cropped: 'front,edge',
      isbn13: '9780553287899', claimedBy: 'bob', note: 'No catalogue has it.',
    }])
    await migrateToLatest(pool)

    const row = await pool.query(
      `SELECT title, shelf_range, sort_key, state, isbn13, claimed_by, scan_note,
              scanned_at
         FROM books WHERE state = 'unidentified'`,
    )
    expect(row.rows[0]).toEqual({
      // Empty because nobody has read this book, not lost: a title nobody
      // has stated has no value, and a book with no range or key can never
      // reach a shelf.
      title: '', shelf_range: '', sort_key: '',
      state: 'unidentified',
      isbn13: '9780553287899',
      // The claim survives the move. Somebody is holding this book.
      claimed_by: 'bob',
      // `note` on the queue row, `scan_note` here, because `books.notes` is
      // already a person's note about a book.
      scan_note: 'No catalogue has it.',
      // When the photograph was taken, which is when the queue row was made.
      scanned_at: '2026-02-03T04:05:06.000Z',
    })

    // `crop_file` and `examined` come from the queue's own `front_crop`
    // and `cropped`. The spine is a `spine` here, though `edge` was the
    // column name: that vocabulary is the model's.
    const photographs = await pool.query(
      `SELECT c.kind, c.file, c.crop_file, c.examined
         FROM capture c JOIN books b ON b.id = c.book_id
        WHERE b.state = 'unidentified'
        ORDER BY c.kind`,
    )
    expect(photographs.rows).toEqual([
      { kind: 'back', file: 'q_back.jpg', crop_file: '', examined: false },
      { kind: 'front', file: 'q_front.jpg', crop_file: 'q_front_crop.jpg', examined: true },
      { kind: 'spine', file: 'q_edge.jpg', crop_file: '', examined: true },
    ])
  }, 60_000)

  /**
   * The half of `0006` deferred here on purpose: `captures.book_id` was
   * nullable, since a capture waiting to be confirmed was not a book yet,
   * while `capture.book_id` is NOT NULL because a book exists from its
   * first photograph. Once the queue row is a book row that objection
   * dissolves with the table.
   */
  it('turns the queue photographs nobody could migrate into capture rows', async () => {
    const pool = await catalogueOf(1, [{
      status: 'pending',
      front: 'q_front.jpg', back: 'q_back.jpg', edge: 'q_edge.jpg',
      frontCrop: 'q_front_crop.jpg', cropped: 'front,back',
    }])
    await migrateToLatest(pool)

    const rows = await pool.query<{ kind: string; file: string; crop_file: string; examined: boolean }>(
      `SELECT c.kind, c.file, c.crop_file, c.examined
         FROM capture c JOIN books b ON b.id = c.book_id
        WHERE b.state = 'scanned' ORDER BY c.kind`,
    )
    expect(rows.rows).toEqual([
      // `edge` becomes `spine`, the vocabulary docs/data-model.md settles.
      { kind: 'back', file: 'q_back.jpg', crop_file: '', examined: true },
      { kind: 'front', file: 'q_front.jpg', crop_file: 'q_front_crop.jpg', examined: true },
      // Named in no slot of `cropped`, so the detector has never looked at
      // it, a different fact from having looked and declined.
      { kind: 'spine', file: 'q_edge.jpg', crop_file: '', examined: false },
    ])
  }, 60_000)

  it('is safe to run twice, and makes nothing the second time', async () => {
    const pool = await catalogueOf(4, ONE_OF_EACH)
    await migrateToLatest(pool)
    const after = await statesIn(pool)
    const captures = await pool.query('SELECT count(*)::text AS n FROM capture')

    // `migrateToLatest` records what it applied, so a second call runs
    // nothing; running the file itself again is what a rebuilt journal or
    // a hand-run recovery would do, and where a migration that trusted its
    // own statements would double every queue row.
    await pool.query(migrationSql())

    expect(await statesIn(pool)).toEqual(after)
    expect((await pool.query('SELECT count(*)::text AS n FROM capture')).rows[0])
      .toEqual(captures.rows[0])
  }, 60_000)
})

/** The migration, read off disk, so the re-run above runs the real statements. */
function migrationSql(): string {
  return readFileSync(
    fileURLToPath(new URL('./migrations/0011_the_queue_becomes_books.sql', import.meta.url)),
    'utf8',
  )
}
