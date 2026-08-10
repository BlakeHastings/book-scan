/**
 * The claim the tag cut-over rests on, checked book by book.
 *
 * **The genre tags, applied to a catalogue, file every book into exactly the
 * range `books.is_fiction` files it into.** Not approximately, and not "the
 * counts agree": every shelved book is placed twice, once by the column the app
 * has always filed by and once by `rangeOfGenre` over the rows `0002` derived
 * from it, and the two answers are compared one book at a time.
 *
 * This is the first step of #170's cut-over that gives up the ability to make
 * that comparison afterwards. Every step before it added tables beside the ones
 * in use and left the old ones authoritative, which is what made them checkable.
 * From here `books.is_fiction` decides nothing, so the comparison has to happen
 * *during* the change: this file is that comparison, run against a catalogue
 * carrying the provenance the live one carries, and three of its tests break the
 * derivation on purpose so it is watched naming the books it should.
 *
 * It also covers `0016`, the repair the cut-over owes, which is the one thing
 * here that rewrites what somebody answered. See "One repair the cut-over owes"
 * in docs/data-model.md.
 *
 * Nothing in this file connects to anything but a scratch database it made, and
 * nothing anywhere here reads, writes or deletes a cover file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { rangeOfGenre } from '../../domain/tagging/genre'
import { TagSlug, type AppliedTag, type TagConfidence, type TagSource } from '../../domain/tagging/tags'
import { SCHEMA } from '../../server/db.pg'
import type { ShelfRange } from '../../shared/shelving'
import { migrateToLatest } from './migrate'
import { dropScratchDatabases, migrationsThrough, scratchDatabase } from './testdb'

/**
 * The catalogues open right now, given back as each test finishes with one.
 *
 * `dropScratchDatabases` closes every pool a file made and drops the databases,
 * and for a file that makes half a dozen that is the whole story. This one makes
 * a dozen, and a dozen pools alive at once beside the dozen
 * `placement-backfill.test.ts` keeps open ran the container out of connections
 * under a full parallel run: `sorry, too many clients already`, raised by
 * `CREATE DATABASE` in a third file that had done nothing wrong. Handing the
 * connections back per test holds one catalogue open instead of twelve. The
 * `afterAll` still drops them, and a second `end()` on a closed pool is caught
 * there.
 */
const openHere: pg.Pool[] = []

afterEach(async () => {
  await Promise.all(openHere.splice(0).map((pool) => pool.end().catch(() => undefined)))
})

afterAll(async () => {
  await dropScratchDatabases()
})

// ---------------------------------------------------------------------------
// A catalogue in the state the owner's is in
// ---------------------------------------------------------------------------

interface SeedBook {
  title: string
  sortKey: string
  range: ShelfRange
  /** What `classification_source` says, which is what `0002` reads. */
  source: 'manual' | 'auto'
  confidence: string
}

/**
 * 236 books, which is what the live catalogue held when #192 measured it.
 *
 * Every third book is non-fiction, so both ranges are populated and the
 * interesting failure, a derivation that gets the big range right and the other
 * one wrong, has somewhere to show up. Every fourth was decided by a person, so
 * `0002` writes both a `person` and a `guess` provenance and the source
 * precedence in `rangeOfGenre` is exercised over the whole catalogue rather
 * than in one contrived row.
 */
const LIVE_SIZED: SeedBook[] = Array.from({ length: 236 }, (_, at) => ({
  title: `Book ${String(at).padStart(3, '0')}`,
  sortKey: `key-${String(at).padStart(4, '0')}`,
  range: at % 3 === 0 ? ('nonfiction' as const) : ('fiction' as const),
  source: at % 4 === 0 ? ('manual' as const) : ('auto' as const),
  confidence: ['high', 'medium', 'weak', ''][at % 4]!,
}))

/**
 * The catalogue as stage H left it: the pre-Drizzle schema, and never migrated.
 *
 * `SCHEMA` rather than `applySchema`, for the reason the other backfill tests
 * give: `applySchema` runs the migrations itself and would hand back a database
 * that had already had the ones under test.
 */
async function catalogueOf(books: SeedBook[]): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  openHere.push(pool)
  await pool.query(SCHEMA)

  if (books.length) {
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at,
                          classification_source, classification_confidence)
       SELECT title, shelf_range, is_fiction, sort_key, '2026-01-02T03:04:05.000Z',
              source, confidence
         FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[])
              WITH ORDINALITY AS seed(title, shelf_range, is_fiction, sort_key,
                                      source, confidence, at)
        ORDER BY at`,
      [
        books.map((book) => book.title),
        books.map((book) => book.range),
        books.map((book) => (book.range === 'fiction' ? 1 : 0)),
        books.map((book) => book.sortKey),
        books.map((book) => book.source),
        books.map((book) => book.confidence),
      ],
    )
  }

  return pool
}

/**
 * A second genre tag on one book, in a database that has already been migrated.
 *
 * This is what a book corrected before #201 carries: the old book's genre tag
 * left beside the new one, and the higher-authority row the wrong one. It is
 * written straight into the tables because no code path produces one any more,
 * and **after** the migrations because the tag tables do not exist before them.
 */
async function alsoTagged(
  pool: pg.Pool,
  title: string,
  slug: string,
  source: TagSource = 'person',
): Promise<void> {
  await pool.query(
    "INSERT INTO tag (slug, label, note) VALUES ($1, $1, '') ON CONFLICT (slug) DO NOTHING",
    [slug],
  )
  await pool.query(
    `INSERT INTO book_tag (book_id, tag_id, source, confidence, added_at)
     SELECT b.id, t.id, $3, 'high', '2026-03-01T00:00:00.000Z'
       FROM books b, tag t
      WHERE b.title = $1 AND t.slug = $2
     ON CONFLICT DO NOTHING`,
    [title, slug, source],
  )
}

// ---------------------------------------------------------------------------
// The two derivations, each asked which range every book joins
// ---------------------------------------------------------------------------

interface Filed {
  id: number
  title: string
  range: ShelfRange | null
}

/**
 * Where the column files every book: what the app filed by until #223.
 *
 * **Read before the migrations run, and from `books`.** `shelved_books` does not
 * exist on a catalogue as stage H left it, and `books.is_fiction` does not exist
 * on one the migrations have finished with: `0018` drops it. Every row this seeds
 * is `shelved`, and nothing here writes to `books`, so the answer taken on the
 * way in is the answer throughout.
 */
async function underTheColumn(pool: pg.Pool): Promise<Filed[]> {
  const { rows } = await pool.query<{ id: number; title: string; is_fiction: number }>(
    'SELECT id, title, is_fiction FROM books ORDER BY id',
  )
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    range: row.is_fiction === 1 ? 'fiction' : 'nonfiction',
  }))
}

/** Where the genre tags file every book, run through the domain rule. */
async function underTheTags(pool: pg.Pool): Promise<Filed[]> {
  const { rows } = await pool.query<{
    id: number; title: string
    slugs: string[]; sources: TagSource[]; confidences: TagConfidence[]
  }>(
    // The three arrays are aggregated in one order so they stay index aligned:
    // a slug and the source that wrote it have to arrive as a pair.
    `SELECT b.id, b.title,
            array_remove(array_agg(t.slug ORDER BY t.slug, bt.source), NULL) AS slugs,
            array_remove(array_agg(bt.source ORDER BY t.slug, bt.source), NULL) AS sources,
            array_remove(array_agg(bt.confidence ORDER BY t.slug, bt.source), NULL)
              AS confidences
       FROM shelved_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      GROUP BY b.id, b.title
      ORDER BY b.id`,
  )

  return rows.map((row) => {
    const carried: AppliedTag[] = row.slugs.map((slug, at) => ({
      slug: TagSlug.of(slug),
      source: row.sources[at]!,
      confidence: row.confidences[at]!,
    }))
    return { id: row.id, title: row.title, range: rangeOfGenre(carried) }
  })
}

/** What the column `Shelves` actually reads says, which both must agree with. */
async function underShelfRange(pool: pg.Pool): Promise<Filed[]> {
  const { rows } = await pool.query<{ id: number; title: string; shelf_range: ShelfRange }>(
    'SELECT id, title, shelf_range FROM shelved_books ORDER BY id',
  )
  return rows.map((row) => ({ id: row.id, title: row.title, range: row.shelf_range }))
}

/** The books the two derivations disagree about, said the way a reviewer reads it. */
function disagreements(old: Filed[], now: Filed[]): string[] {
  const byId = new Map(now.map((one) => [one.id, one]))
  return old.flatMap((one) => {
    const other = byId.get(one.id)
    return other && other.range === one.range
      ? []
      : [`${one.title}: the column says ${one.range}, the tags say ${other?.range ?? 'nothing'}`]
  })
}

/** The shelf order hash, spelled as `server/backup.ts` and `0013` spell it. */
async function shelfOrder(pool: pg.Pool, from: string): Promise<string | null> {
  const { rows } = await pool.query<{ hash: string | null }>(
    `SELECT md5(string_agg(id::text, ',' order by sort_key, id)) AS hash FROM ${from}`,
  )
  return rows[0]?.hash ?? null
}

/** The repair, as a statement, so it can be watched running on rows written after it. */
function repairStatement(): string {
  return readFileSync(
    fileURLToPath(new URL('./migrations/0016_one_genre_tag_per_book.sql', import.meta.url)),
    'utf8',
  )
}

/** Run a statement and hand back everything postgres said out loud. */
async function noticesFrom(pool: pg.Pool, sql: string): Promise<string[]> {
  const client = await pool.connect()
  const said: string[] = []
  const listen = (notice: { message?: string }) => said.push(notice.message ?? '')
  client.on('notice', listen)
  try {
    await client.query(sql)
  } finally {
    client.off('notice', listen)
    client.release()
  }
  return said
}

/** Every genre row on one book, so a repair can be read back off it. */
async function genreRowsOf(pool: pg.Pool, title: string) {
  const { rows } = await pool.query<{ slug: string; source: string }>(
    `SELECT t.slug, bt.source
       FROM books b
       JOIN book_tag bt ON bt.book_id = b.id
       JOIN tag t ON t.id = bt.tag_id
      WHERE b.title = $1 AND t.slug LIKE 'genre/%'
      ORDER BY t.slug, bt.source`,
    [title],
  )
  return rows
}

// ---------------------------------------------------------------------------

describe('the genre tag deciding which range a book files into', () => {
  it('files every book exactly where books.is_fiction files it', async () => {
    const pool = await catalogueOf(LIVE_SIZED)

    const before = await shelfOrder(pool, 'books WHERE checked_out_at IS NULL')
    const old = await underTheColumn(pool)
    // Adopted, because this database has the baseline tables and has never been
    // migrated. That is the path the real catalogue takes.
    expect(await migrateToLatest(pool)).toBe('adopted')

    const now = await underTheTags(pool)

    expect(old).toHaveLength(LIVE_SIZED.length)
    expect(disagreements(old, now)).toEqual([])
    // And the column everything actually reads agrees with both, which is what
    // says no book has to move for the derivation to change.
    expect(disagreements(await underShelfRange(pool), now)).toEqual([])

    // Printed rather than only asserted, because these are the two strings the
    // pull request quotes.
    const after = await shelfOrder(pool, 'shelved_books')
    console.log(`[genre] shelf order ${before} before, ${after} after; ` +
      `${old.length} books filed twice and compared one at a time`)
    expect(after).toBe(before)

    // The precedence in `rangeOfGenre` is worth nothing if every row arrives as
    // a guess. `0002` maps `manual` to `person`, and a quarter of this
    // catalogue was decided by one, so the comparison above ran over both.
    // Asserted here rather than on a catalogue of its own, because a database
    // costs connections the container has not many of; see `openHere`.
    const { rows } = await pool.query<{ source: string; n: string }>(
      `SELECT bt.source, count(*)::text AS n
         FROM book_tag bt JOIN tag t ON t.id = bt.tag_id
        WHERE t.slug LIKE 'genre/%' GROUP BY bt.source ORDER BY bt.source`,
    )
    expect(rows).toEqual([
      { source: 'guess', n: String(LIVE_SIZED.filter((b) => b.source === 'auto').length) },
      { source: 'person', n: String(LIVE_SIZED.filter((b) => b.source === 'manual').length) },
    ])
  })

  it('names the book that crosses when one tag is swapped for the other', async () => {
    /*
     * The failure this step could have that nobody would see: a book whose tag
     * says one range and whose column says the other files into a different
     * bookcase the moment the tag starts deciding. Swap one row and the
     * comparison names exactly that book.
     */
    const pool = await catalogueOf(LIVE_SIZED)
    const old = await underTheColumn(pool)
    await migrateToLatest(pool)
    expect(disagreements(old, await underTheTags(pool))).toEqual([])

    await pool.query(
      `UPDATE book_tag SET tag_id = (SELECT id FROM tag WHERE slug = 'genre/non-fiction')
        WHERE book_id = (SELECT id FROM books WHERE title = 'Book 040')`,
    )

    expect(disagreements(old, await underTheTags(pool)))
      .toEqual(['Book 040: the column says fiction, the tags say nonfiction'])
  })

  it('names a book whose genre tag somebody took off', async () => {
    // The one state the running app can reach where nothing files a book, and
    // the thing `applySchema` reports on every start.
    const pool = await catalogueOf(LIVE_SIZED)
    const old = await underTheColumn(pool)
    await migrateToLatest(pool)

    await pool.query(
      "DELETE FROM book_tag WHERE book_id = (SELECT id FROM books WHERE title = 'Book 041')",
    )

    expect(disagreements(old, await underTheTags(pool)))
      .toEqual(['Book 041: the column says fiction, the tags say nothing'])
    // And it has not moved: `shelf_range` is written by a save and by nothing
    // else, so the book is exactly where it was.
    const still = await underShelfRange(pool)
    expect(still.find((one) => one.title === 'Book 041')?.range).toBe('fiction')
  })

  it('follows the person when a catalogue disagrees with one', async () => {
    /*
     * `POST /api/books/:id/tags/refresh` can put a catalogue's genre on a book
     * a person filed, because a lookup may not retract a person's row. The
     * column is untouched by a refresh, so the two must still agree, and they
     * only do because `rangeOfGenre` reads the person's row first.
     */
    const pool = await catalogueOf(LIVE_SIZED)
    const old = await underTheColumn(pool)
    await migrateToLatest(pool)

    // Book 000 is non-fiction and was decided by a person.
    await alsoTagged(pool, 'Book 000', 'genre/fiction', 'catalogue')

    expect(disagreements(old, await underTheTags(pool))).toEqual([])
  })
})

describe('the repair the cut-over owes', () => {
  /** A catalogue with two books corrected before #201, as docs/data-model.md describes. */
  async function withCorrectedBooks(): Promise<pg.Pool> {
    const pool = await catalogueOf(LIVE_SIZED)
    /*
     * Through `0016` rather than to the end, because `0018` drops
     * `books.is_fiction` and this repair keeps the genre row that agrees with
     * it. A catalogue migrated past that point is one the statement below could
     * never have met, so watching it run there would prove nothing.
     */
    await migrationsThrough(pool, '0016_one_genre_tag_per_book')
    // Book 000 is non-fiction and carries a person's `genre/non-fiction`. The
    // old book's tag left behind is a fiction one, from a person, and it is the
    // higher-authority row on a book whose column says non-fiction.
    await alsoTagged(pool, 'Book 000', 'genre/fiction', 'person')
    // Book 041 is fiction and carries a guess. The stale row is a person's
    // non-fiction: the exact shape #194 described.
    await alsoTagged(pool, 'Book 041', 'genre/non-fiction', 'person')
    return pool
  }

  it('keeps the row that agrees with books.is_fiction, not the one with the higher source', async () => {
    const pool = await withCorrectedBooks()

    // Before: both books carry both, and on Book 041 the person's row is the
    // wrong one. That is the defect, stated as rows.
    expect(await genreRowsOf(pool, 'Book 041')).toEqual([
      { slug: 'genre/fiction', source: 'guess' },
      { slug: 'genre/non-fiction', source: 'person' },
    ])

    const before = await shelfOrder(pool, 'shelved_books')
    const said = await noticesFrom(pool, repairStatement())
    const after = await shelfOrder(pool, 'shelved_books')

    // The guess survives and the person's row goes, because the column is what
    // the shelf was built from and the person's answer was about a different
    // book. Keeping the higher source is the obvious answer and the wrong one.
    expect(await genreRowsOf(pool, 'Book 041')).toEqual([
      { slug: 'genre/fiction', source: 'guess' },
    ])
    expect(await genreRowsOf(pool, 'Book 000')).toEqual([
      { slug: 'genre/non-fiction', source: 'person' },
    ])

    // Two books, two rows removed, and both of them somebody's answer. A repair
    // that silently rewrites a person's answer is the same class of thing as
    // the defect, so the number is the accounting for it.
    expect(said.some((line) =>
      line.includes('2 books carried both range genres, 2 rows removed, 2 of them a person'),
    )).toBe(true)

    // And not one book moved, which the migration checks itself and refuses on.
    expect(after).toBe(before)
    expect(said.some((line) => line.startsWith('shelf order unchanged'))).toBe(true)
    console.log(`[genre] repair shelf order ${before} before, ${after} after`)
  })

  it('leaves a genre that is not one of the two ranges exactly where it is', async () => {
    /*
     * `genre/fantasy` is a real tag somebody may have applied, and
     * `books.is_fiction` can neither agree nor disagree with it, so the rule has
     * nothing to say about it. Deleting it would be the loss this whole model
     * exists to prevent.
     */
    const pool = await withCorrectedBooks()
    await alsoTagged(pool, 'Book 041', 'genre/fantasy', 'person')

    const said = await noticesFrom(pool, repairStatement())

    expect(await genreRowsOf(pool, 'Book 041')).toEqual([
      { slug: 'genre/fantasy', source: 'person' },
      { slug: 'genre/fiction', source: 'guess' },
    ])
    // And it is reported rather than passed over, because a book carrying two
    // genres is still a book somebody should look at.
    expect(said.some((line) => line.includes('1 books still carry more than one genre tag')))
      .toBe(true)
  })

  it('is safe to run again, and says plainly when there is nothing to repair', async () => {
    const pool = await withCorrectedBooks()
    await pool.query(repairStatement())
    const repaired = await genreRowsOf(pool, 'Book 041')

    // A migration somebody is not sure finished should be safe to set going
    // again, and a run with nothing to do has to say so rather than going
    // quiet: silence and success look the same in a log.
    const said = await noticesFrom(pool, repairStatement())
    expect(await genreRowsOf(pool, 'Book 041')).toEqual(repaired)
    expect(said.some((line) =>
      line.includes('no book carried both genre/fiction and genre/non-fiction'),
    )).toBe(true)
  })

  it('turns two derivations that disagreed into two that agree', async () => {
    /*
     * The point of the repair, said as the comparison this file is about.
     *
     * Book 003 is non-fiction and was decided by the classifier, so both its
     * genre rows are guesses and neither outranks the other. A doubly tagged
     * book files as fiction by tag order, which is `0013`'s rule 1, so the two
     * models place it differently until the stale row is gone.
     */
    const pool = await catalogueOf(LIVE_SIZED)
    const old = await underTheColumn(pool)
    await migrationsThrough(pool, '0016_one_genre_tag_per_book')
    await alsoTagged(pool, 'Book 003', 'genre/fiction', 'guess')

    expect(disagreements(old, await underTheTags(pool)))
      .toEqual(['Book 003: the column says nonfiction, the tags say fiction'])

    await pool.query(repairStatement())

    expect(disagreements(old, await underTheTags(pool))).toEqual([])
  })
})
