/**
 * The migration that gives every book a state, and the view that is the only
 * relation a shelf is drawn from, run on a database in the state the owner's
 * catalogue is in.
 *
 * That state is specific and it is why this file exists rather than a paragraph
 * in a pull request: the live catalogue was built by `applySchema` during stage
 * H and has never had a migration recorded against it, so a run there **adopts**
 * the baseline and then applies everything after it. That is what is done below,
 * on a database seeded here.
 *
 * Two claims have to be checked by a machine, and the second one is the whole
 * risk in #183.
 *
 * 1. **Every book ends up in the state it is actually in**, taken from the
 *    column the shelf has always been drawn with rather than from an assumption
 *    about what a row in `books` means. The migration counts that itself and
 *    refuses to finish when a row is left undecided.
 *
 * 2. **No book moved.** The shelf order hash `docs/backup-runbook.md` compares
 *    restores with is taken either side of the migration and has to be the same
 *    string. A count does not move when an ordering does, and an ordering that
 *    moved has not lost a book: it has told somebody to put one in the wrong
 *    place. Then the same check is shown failing to move for the right reason,
 *    by putting a book in the catalogue that is not on a shelf and watching it
 *    stay out of the view, out of the neighbours and out of the layout.
 *
 * Nothing in this file, or in the migration it exercises, connects to anything
 * but a scratch database this test made, and nothing anywhere reads, writes or
 * deletes a cover file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { BOOK_STATES } from '../../domain/books/state'
import { SCHEMA } from '../../server/db.pg'
import { migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await dropScratchDatabases()
})

interface Seed {
  title: string
  sortKey?: string
  /** ISO timestamp for a book somebody has taken away, null for one on a shelf. */
  checkedOutAt?: string | null
  shelfRange?: 'fiction' | 'nonfiction'
}

/**
 * A database with the pre-Drizzle schema and some books in it.
 *
 * `SCHEMA` rather than `applySchema`, which runs the migrations itself and would
 * hand back a database that had already had this one. `SCHEMA` is the fixed
 * point the baseline is proved against, and it is what stage H left on the live
 * catalogue.
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
 * The shelf order hash, spelled exactly as `server/backup.ts` and the stage H
 * rehearsal spell it. The point of reusing the expression rather than writing a
 * clearer one is that this is the string a restore is verified against, so a
 * migration that leaves it alone leaves the check that guards the backups alone
 * too.
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
 * A catalogue the size of the real one, with a realistic number of books off
 * the shelf.
 *
 * 236 books is what the live catalogue held when #192 measured it, and every
 * seventh one is checked out, which is more than the owner has ever had out at
 * once and is deliberately so: the interesting failure is a migration that gets
 * the common case right and the other one wrong.
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

    // Adopted, because this database has the baseline tables and has never been
    // migrated. That is the path the real catalogue would take.
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

    // Read out of the fixture rather than written down, so the assertion cannot
    // drift from the seed. 236 books, 34 of them checked out.
    const out = LIVE_SIZED.filter((book) => book.checkedOutAt).length
    expect(await statesIn(pool)).toEqual({
      shelved: LIVE_SIZED.length - out,
      checked_out: out,
    })
    expect(out).toBe(34)

    // No row anywhere else, which is the guard's own claim asserted from
    // outside it: `scanned` is the column's default and is true of no row that
    // was already in the catalogue.
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
    // And the shelf, read the new way. This is the pair that matters: the same
    // books in the same order, arrived at through a view instead of a WHERE
    // clause, on a database whose own collation is linguistic.
    expect(await hashOf(pool, 'shelved_books')).toBe(shelfBefore)
    expect(shelfBefore).not.toBe(catalogueBefore)

    // Printed rather than only asserted, because these two strings are what the
    // pull request quotes and a reader should be able to see where they came
    // from. See `docs/backup-runbook.md` for what else compares them.
    console.log(`[state] catalogue order ${catalogueBefore}, shelf order ${shelfBefore}`)
  })

  it('keeps a book that is not on a shelf out of the view, which is the point', async () => {
    /*
     * The check above proving it can fail. Every row so far was `shelved` or
     * `checked_out`, so a view that dropped its predicate would have hashed the
     * same and passed. Here is a book in the catalogue that is not on a shelf:
     * it must be in `books`, must not be in `shelved_books`, and must move the
     * shelf order hash if it ever reaches it.
     *
     * `unidentified` is the state the queue table holds today, and putting one
     * between two real books on somebody's shelf listing is the failure #183
     * exists to design against.
     */
    const pool = await catalogueOf([
      { title: 'Alpha', sortKey: 'key-0001' },
      { title: 'Gamma', sortKey: 'key-0003' },
    ])
    await migrateToLatest(pool)

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

    // And the same row read the way the old code read it, which is what the
    // view replaces. This is the assertion that says the two are not the same
    // question any more: `checked_out_at IS NULL` lets it straight through.
    expect(await hashOf(pool, 'books', 'WHERE checked_out_at IS NULL'))
      .not.toBe(shelfBefore)
  })

  it('plans the shelf query on the partial index rather than reading the table', async () => {
    /*
     * A partial index whose predicate does not match the query's is not a slower
     * index, it is an index the planner cannot use at all, and the only symptom
     * is a sequential scan nobody looks at. `enable_seqscan = off` asks whether
     * the index is usable rather than whether the planner preferred it, which on
     * a fixture this size it never would.
     */
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
    // The check constraint, which is what stops a typo becoming a book nothing
    // can see. Asserted with a value that reads plausibly rather than with
    // rubbish: `shelfed` is the mistake somebody actually makes.
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
    /*
     * The loud failure, watched rather than asserted about.
     *
     * It is not reachable from the migration's own two statements: `checked_out_at`
     * is either null or it is not, so between them they state every row. It is
     * here for the edit that breaks that, which would otherwise give half a
     * catalogue a state no shelf query can see and complete quietly. So the guard
     * is run against a row it was never given a chance to decide about, read out
     * of the shipped file rather than copied into this test, because a copy is a
     * second thing to keep in step and would go green while the file was wrong.
     */
    const pool = await catalogueOf([{ title: 'Dune' }, { title: 'Neuromancer' }])
    await migrateToLatest(pool)
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

  it('leaves the column the client reads exactly as it was', async () => {
    // Nothing is dropped by this migration. `checked_out_at` is still what the
    // client reads and what `Store.setCheckedOut` compares and sets, and the
    // state is written beside it rather than instead of it.
    const pool = await catalogueOf([
      { title: 'On the shelf' },
      { title: 'Out', checkedOutAt: '2026-03-01T00:00:00.000Z' },
    ])
    await migrateToLatest(pool)

    const rows = await pool.query<{ title: string; checked_out_at: string | null }>(
      'SELECT title, checked_out_at FROM books ORDER BY title',
    )
    expect(rows.rows).toEqual([
      { title: 'On the shelf', checked_out_at: null },
      { title: 'Out', checked_out_at: '2026-03-01T00:00:00.000Z' },
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
