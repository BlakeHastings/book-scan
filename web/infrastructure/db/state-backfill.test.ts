/**
 * The migration that gives every book a state, and the view that is the
 * only relation a shelf is drawn from, run on a database in the state the
 * owner's catalogue is in: built by `applySchema` and never migrated, so a
 * run here adopts the baseline and then applies everything after it.
 *
 * Two claims are checked by a machine:
 *
 * 1. Every book ends up in the state it is actually in, taken from the
 *    column the shelf has always been drawn with. The migration counts
 *    that itself and refuses to finish when a row is left undecided.
 *
 * 2. No book moved. The shelf order hash `docs/backup-runbook.md` compares
 *    restores with is taken either side of the migration and has to be the
 *    same string. The same check is then shown failing to move for the
 *    right reason, by putting a book in the catalogue that is not on a
 *    shelf and watching it stay out of the view.
 *
 * Nothing in this file, or in the migration it exercises, connects to
 * anything but a scratch database this test made.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { BOOK_STATES } from '../../domain/books/state'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
import { closeScratchDatabases, migrationsThrough, scratchDatabase } from './testdb'

/**
 * As far down the folder as a test about one of these columns can be
 * taken. `0024` drops `books.location`, `0025` `books.shelved_at` and
 * `0026` `books.checked_out_at`, so a test about one of those columns
 * cannot run against a database that has had the whole folder.
 *
 * `0022` rather than `0023`, which drops nothing: `0023` opens with a
 * `CREATE TEMP TABLE ... ON COMMIT DROP`, and `migrationsThrough` runs
 * statements one at a time on a pool rather than in one transaction, so the
 * temp table would already be gone before the block that reads it.
 */
const BEFORE_THE_DROPS = '0022_the_alias_is_where_a_book_files'

afterAll(async () => {
  await closeScratchDatabases()
})

interface Seed {
  title: string
  sortKey?: string
  /** ISO timestamp for a book somebody has taken away, null for one on a shelf. */
  checkedOutAt?: string | null
  shelfRange?: 'fiction' | 'nonfiction'
}

/**
 * A database with the pre-Drizzle schema and some books in it. Uses
 * `SCHEMA` rather than `applySchema`, which runs the migrations itself and
 * would hand back a database that had already had this one.
 */
async function catalogueOf(books: Seed[]): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await pool.query(SCHEMA)

  for (const [at, book] of books.entries()) {
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at, checked_out_at)
       VALUES ($1, $2, $3, $4, '2026-01-02T03:04:05.000Z', $5)`,
      [
        book.title,
        book.shelfRange ?? 'fiction',
        book.shelfRange === 'nonfiction' ? 0 : 1,
        book.sortKey ?? `key-${String(at).padStart(4, '0')}`,
        book.checkedOutAt ?? null,
      ],
    )
  }
  return pool
}

/**
 * The shelf order hash, spelled exactly as `server/backup.ts` does: this is
 * the string a restore is verified against, so a migration that leaves it
 * alone leaves that check alone too.
 */
const SHELF_ORDER = "md5(string_agg(id::text, ',' order by sort_key, id))"

async function hashOf(pool: pg.Pool, relation: string, where = ''): Promise<string | null> {
  const rows = await pool.query<{ hash: string | null }>(
    `SELECT ${SHELF_ORDER} AS hash FROM ${relation} ${where}`,
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
 * A catalogue the size of the real one, with a realistic number of books
 * off the shelf: every seventh one checked out, more than the owner has
 * ever had out at once, so a migration that gets the common case right and
 * the uncommon one wrong has somewhere to show up.
 */
const LIVE_SIZED: Seed[] = Array.from({ length: 236 }, (_, at) => ({
  title: `Book ${String(at).padStart(3, '0')}`,
  sortKey: `key-${String(at).padStart(4, '0')}`,
  checkedOutAt: at % 7 === 0 ? `2026-03-0${(at % 9) + 1}T00:00:00.000Z` : null,
  shelfRange: at % 3 === 0 ? ('nonfiction' as const) : ('fiction' as const),
}))

describe('books getting the state they are in', () => {
  it('files a shelved book and a checked-out one apart, from the data', async () => {
    const pool = await catalogueOf([
      { title: 'On the shelf' },
      { title: 'In a box on the floor', checkedOutAt: '2026-03-01T00:00:00.000Z' },
    ])

    // Adopted: this database has the baseline tables and has never been migrated.
    expect(await migrateToLatest(pool)).toBe('adopted')

    const rows = await pool.query<{ title: string; state: string }>(
      'SELECT title, state FROM books ORDER BY title',
    )
    expect(rows.rows).toEqual([
      { title: 'In a box on the floor', state: 'checked_out' },
      { title: 'On the shelf', state: 'shelved' },
    ])
  })

  it('leaves every book in a state, across a catalogue the size of the real one', async () => {
    const pool = await catalogueOf(LIVE_SIZED)
    await migrateToLatest(pool)

    // Read out of the fixture rather than written down, so the assertion cannot drift from the seed.
    const out = LIVE_SIZED.filter((book) => book.checkedOutAt).length
    expect(await statesIn(pool)).toEqual({
      shelved: LIVE_SIZED.length - out,
      checked_out: out,
    })
    expect(out).toBe(34)

    // No row anywhere else: `scanned` is the column's default and true of
    // no row already in the catalogue.
    const undecided = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM books WHERE state NOT IN ('shelved', 'checked_out')",
    )
    expect(undecided.rows[0]!.n).toBe('0')
  })

  it('moves no book: the shelf order hash is the same string either side', async () => {
    const pool = await catalogueOf(LIVE_SIZED)

    // Taken on the catalogue as it stands, before a migration has touched it.
    const catalogueBefore = await hashOf(pool, 'books')
    const shelfBefore = await hashOf(pool, 'books', 'WHERE checked_out_at IS NULL')

    await migrateToLatest(pool)

    // The whole catalogue, which nothing was supposed to reorder or lose.
    expect(await hashOf(pool, 'books')).toBe(catalogueBefore)
    // The pair that matters: the same books in the same order, arrived at
    // through a view instead of a WHERE clause.
    expect(await hashOf(pool, 'shelved_books')).toBe(shelfBefore)
    expect(shelfBefore).not.toBe(catalogueBefore)

    // See `docs/backup-runbook.md` for what else compares these hashes.
    console.log(`[state] catalogue order ${catalogueBefore}, shelf order ${shelfBefore}`)
  })

  it('keeps a book that is not on a shelf out of the view, which is the point', async () => {
    // Proves the check above can fail: every row so far was `shelved` or
    // `checked_out`, so a view that dropped its predicate would have hashed
    // the same and passed. This book must be in `books`, must not be in
    // `shelved_books`, and must move the shelf order hash if it ever
    // reaches it. The chain stops before the drops; see BEFORE_THE_DROPS.
    const pool = await catalogueOf([
      { title: 'Alpha', sortKey: 'key-0001' },
      { title: 'Gamma', sortKey: 'key-0003' },
    ])
    await migrationsThrough(pool, BEFORE_THE_DROPS)

    const shelfBefore = await hashOf(pool, 'shelved_books')

    await pool.query(
      `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state)
       VALUES ('Read, and no catalogue has it', 'fiction', 'key-0002',
               '2026-03-01T00:00:00.000Z', 'unidentified')`,
    )

    const inCatalogue = await pool.query<{ title: string }>(
      'SELECT title FROM books ORDER BY sort_key',
    )
    expect(inCatalogue.rows.map((row) => row.title))
      .toEqual(['Alpha', 'Read, and no catalogue has it', 'Gamma'])

    const onShelf = await pool.query<{ title: string }>(
      'SELECT title FROM shelved_books ORDER BY sort_key',
    )
    expect(onShelf.rows.map((row) => row.title)).toEqual(['Alpha', 'Gamma'])
    expect(await hashOf(pool, 'shelved_books')).toBe(shelfBefore)

    // The same row read the old way, which the view replaces:
    // `checked_out_at IS NULL` lets it straight through.
    expect(await hashOf(pool, 'books', 'WHERE checked_out_at IS NULL'))
      .not.toBe(shelfBefore)
  })

  it('plans the shelf query on the partial index rather than reading the table', async () => {
    // A partial index whose predicate does not match the query's cannot be
    // used at all. `enable_seqscan = off` asks whether the index is usable
    // rather than whether the planner preferred it.
    const pool = await catalogueOf(LIVE_SIZED)
    await migrateToLatest(pool)

    const client = await pool.connect()
    let explained: string
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL enable_seqscan = off')
      // The predecessor seek out of `Store.neighbours`, word for word.
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT * FROM shelved_books
          WHERE shelf_range = 'fiction' AND sort_key < 'key-0100' AND id != -1
          ORDER BY sort_key DESC LIMIT 1`,
      )
      explained = plan.rows.map((row) => row['QUERY PLAN']).join('\n')
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }

    expect(explained).toContain('idx_books_shelved')
  })

  it('refuses a state that is not one of the seven', async () => {
    // Asserted with a value that reads plausibly rather than rubbish:
    // `shelfed` is the mistake somebody actually makes.
    const pool = await catalogueOf([{ title: 'Dune' }])
    await migrateToLatest(pool)

    await expect(pool.query("UPDATE books SET state = 'shelfed'"))
      .rejects.toThrow(/books_state_check/)

    const declared = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'books_state_check'`,
    )
    for (const state of BOOK_STATES) {
      expect(declared.rows[0]!.definition).toContain(`'${state}'`)
    }
  })

  it('refuses to finish when a book would be left with no state', async () => {
    // Not reachable from the migration's own two statements normally, since
    // `checked_out_at` is either null or not; forced here for the edit that
    // breaks that. Read out of the shipped file rather than copied into
    // this test, so a copy cannot drift from the file and pass anyway. Run
    // against the schema before the drops, since the guard reads
    // `checked_out_at`; see BEFORE_THE_DROPS.
    const pool = await catalogueOf([{ title: 'Dune' }, { title: 'Neuromancer' }])
    await migrationsThrough(pool, BEFORE_THE_DROPS)
    await pool.query("UPDATE books SET state = 'scanned' WHERE title = 'Dune'")

    await expect(pool.query(guardOf('0008_books_get_the_state_they_are_in')))
      .rejects.toThrow(/would have left 1 of 2 books with no state/)
  })

  it('is not run twice on a database that has already had it', async () => {
    const pool = await catalogueOf(LIVE_SIZED)
    await migrateToLatest(pool)
    const after = await statesIn(pool)
    const hash = await hashOf(pool, 'shelved_books')

    expect(await migrateToLatest(pool)).toBe('migrated')
    expect(await statesIn(pool)).toEqual(after)
    expect(await hashOf(pool, 'shelved_books')).toBe(hash)
  })

  it('leaves the column the state was derived from exactly as it was', async () => {
    // Nothing is dropped by this migration: the state is written beside
    // `checked_out_at` rather than instead of it, so the two can be
    // compared for as long as both exist.
    const pool = await catalogueOf([
      { title: 'On the shelf' },
      { title: 'Out', checkedOutAt: '2026-03-01T00:00:00.000Z' },
    ])
    await migrationsThrough(pool, BEFORE_THE_DROPS)

    const rows = await pool.query<{ title: string; checked_out_at: string | null }>(
      'SELECT title, checked_out_at FROM books ORDER BY title',
    )
    expect(rows.rows).toEqual([
      { title: 'On the shelf', checked_out_at: null },
      { title: 'Out', checked_out_at: '2026-03-01T00:00:00.000Z' },
    ])
  })

  it('says the same moment out of the ledger once the column has gone', async () => {
    // What the client reads once `0026` takes the column away:
    // `withPlacements` in `server/placement-ledger.ts` answers
    // `checked_out_at` from the `created_at` of the latest `checked_out`
    // ledger row, and only while the book is in that state. This is that
    // expression asked of the catalogue directly, so a failure names the
    // rows rather than the wrapper.
    const pool = await catalogueOf([
      { title: 'On the shelf' },
      { title: 'Out', checkedOutAt: '2026-03-01T00:00:00.000Z' },
    ])
    expect(await migrateToLatest(pool)).toBe('adopted')

    const rows = await pool.query<{ title: string; state: string; checked_out_at: string | null }>(
      `SELECT b.title, b.state,
              CASE WHEN b.state = 'checked_out' THEN
                (SELECT p.created_at FROM book_placement p
                  WHERE p.book_id = b.id AND p.kind = 'checked_out'
                  ORDER BY p.id DESC LIMIT 1)
              END AS checked_out_at
         FROM books b ORDER BY b.title`,
    )
    expect(rows.rows).toEqual([
      { title: 'On the shelf', state: 'shelved', checked_out_at: null },
      { title: 'Out', state: 'checked_out', checked_out_at: '2026-03-01T00:00:00.000Z' },
    ])
  })

  it('says nothing about a catalogue with no books in it', async () => {
    const pool = await catalogueOf([])
    expect(await migrateToLatest(pool)).toBe('adopted')
    expect(await statesIn(pool)).toEqual({})
    expect(await hashOf(pool, 'shelved_books')).toBeNull()
  })
})

/** The last statement of a migration, which is where its guard lives. */
function guardOf(tag: string): string {
  const path = fileURLToPath(new URL(`./migrations/${tag}.sql`, import.meta.url))
  const statements = readFileSync(path, 'utf8').split('--> statement-breakpoint')
  return statements[statements.length - 1]!
}
