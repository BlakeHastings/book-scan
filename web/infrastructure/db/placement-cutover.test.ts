/**
 * The claim the placement cut-over rests on, checked book by book.
 *
 * **The rules and the areas put every book exactly where `separators` and
 * `shelf_ranges` put it, and the ledger says exactly what `books.location`
 * said.** Not approximately, and not "the counts agree": every shelved book is
 * placed twice, once by the tables the app has drawn shelves from since it
 * existed and once by the rows `0013` and `0015` derived from them, and the two
 * answers are compared one book at a time.
 *
 * ## Why this one is different from the three cut-overs before it
 *
 * Tags, aliases and photographs were substitutions where the two models could
 * not disagree about anything physical: a genre is a genre, a filing name is a
 * string, a photograph is a file. **This one can disagree about where a book
 * physically is.** `separators` places a book by walking a list of anchors and
 * the rules place it by matching it; `books.location` says where somebody put it
 * and `book_placement` says the same thing as a history. When those disagree,
 * one of them is wrong about a shelf in somebody's house.
 *
 * So the comparison is made twice over, from both ends:
 *
 * - **the shelf**, `layoutRange` over `separators` against `placementOf` over
 *   the areas and the rules, which is `areaDisagreements` and is what
 *   `applySchema` runs on every start;
 * - **the record**, `books.location` against the label the ledger's projection
 *   answers, which is what the client reads once the column has gone.
 *
 * Both are made *during* the change, over a catalogue carrying the shape the
 * live one carries, because afterwards there is nothing left to compare against.
 * Three of the tests here break a derivation on purpose so the comparison is
 * watched naming the books it should.
 *
 * Nothing in this file connects to anything but a scratch database it made.
 */

import pg from 'pg'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { PgDb, SCHEMA } from '../../server/db.pg'
import { withPlacements } from '../../server/placement-ledger'
import { Shelves } from '../../server/shelves'
import { buildSortKey, type ShelfRange } from '../../shared/shelving'
import { layoutRange, type Separator, type SeparatorKind } from '../../shared/layout'
import { areaDisagreements, describeAreaDisagreement } from '../shelving/area-drift'
import { migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

/**
 * The catalogues open right now, given back as each test finishes with one.
 *
 * The same arrangement `cutover.test.ts` explains at length: a pool per scratch
 * database held to the end of the file is how this suite reached postgres's
 * hundred connections, and the symptom landed on whichever unrelated file asked
 * for a database next.
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

const NAMES = [
  'Le Guin, Ursula K.', 'Banks, Iain M.', 'Pratchett, Terry', 'Butler, Octavia E.',
  'Ishiguro, Kazuo', 'Homer', 'National Geographic Society', 'García Márquez, Gabriel',
  'Harari, Yuval Noah', 'Sagan, Carl',
]

interface SeedBook {
  title: string
  filesUnder: string
  range: ShelfRange
  sortKey: string
}

/**
 * 237 books, which is the size the live catalogue was when #227 was written.
 *
 * Every third book is non-fiction, so both runs are populated and the
 * interesting failure, a derivation that gets the big range right and the other
 * one wrong, has somewhere to show up.
 */
const LIVE_SIZED: SeedBook[] = Array.from({ length: 237 }, (_, at) => {
  const title = `Book ${String(at).padStart(3, '0')}`
  const filesUnder = NAMES[at % NAMES.length]!
  return {
    title,
    filesUnder,
    range: at % 3 === 0 ? ('nonfiction' as const) : ('fiction' as const),
    sortKey: buildSortKey({ authorFiling: filesUnder, title }),
  }
})

/** A boundary as the seed states one, before it has an id. */
interface SeedBoundary {
  range: ShelfRange
  kind: SeparatorKind
  /** Which book of that range's run this boundary opens at. */
  at: number
}

/**
 * Eleven boundaries, which is what `0013` was measured against.
 *
 * Two of them are bookcase breaks, because a `shelf` boundary is the case the
 * area model has to derive rather than store: it is an area hanging on a
 * different fixture, and getting it wrong puts a plank's worth of books in the
 * wrong piece of furniture rather than one book out of order.
 */
const BOUNDARIES: SeedBoundary[] = [
  { range: 'fiction', kind: 'area', at: 18 },
  { range: 'fiction', kind: 'area', at: 36 },
  { range: 'fiction', kind: 'shelf', at: 54 },
  { range: 'fiction', kind: 'area', at: 72 },
  { range: 'fiction', kind: 'area', at: 90 },
  { range: 'fiction', kind: 'shelf', at: 108 },
  { range: 'fiction', kind: 'area', at: 126 },
  { range: 'fiction', kind: 'area', at: 144 },
  { range: 'nonfiction', kind: 'area', at: 20 },
  { range: 'nonfiction', kind: 'area', at: 40 },
  { range: 'nonfiction', kind: 'area', at: 60 },
]

/** The books of one range, in shelf order, which is what a boundary indexes. */
function inRange(range: ShelfRange): SeedBook[] {
  return LIVE_SIZED
    .filter((book) => book.range === range)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
}

/** The boundaries of a range, as the layout code takes them. */
function separatorsOf(range: ShelfRange): Separator[] {
  const books = inRange(range)
  return BOUNDARIES
    .filter((one) => one.range === range)
    .map((one, position): Separator => ({
      id: position + 1,
      range,
      kind: one.kind,
      startsAt: books[one.at]!.sortKey,
      position,
    }))
}

/** Where a range's run begins, which is what `shelf_ranges` holds. */
const START = { fiction: { shelf: 1, area: 0 }, nonfiction: { shelf: 4, area: 0 } }

/**
 * Where the app puts every book today: `layoutRange` over the separators, which
 * is the sequence `Shelves.layout` performs.
 */
function plankOf(): Map<string, string> {
  const placed = new Map<string, string>()
  for (const range of ['fiction', 'nonfiction'] as const) {
    for (const one of layoutRange(
      inRange(range).map((book) => ({ id: 0, sortKey: book.sortKey, title: book.title })),
      separatorsOf(range),
      START[range],
    )) {
      placed.set(one.book.title, one.label)
    }
  }
  return placed
}

/**
 * The catalogue as stage H left it: the pre-Drizzle schema, and never migrated.
 *
 * `SCHEMA` rather than `applySchema`, for the reason the other backfill tests
 * give: `applySchema` runs the migrations itself and would hand back a database
 * that had already had the ones under test.
 */
async function catalogueOf(): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  openHere.push(pool)
  await pool.query(SCHEMA)

  await pool.query(
    `INSERT INTO shelf_ranges (shelf_range, start_label, start_shelf, start_area, note)
     VALUES ('fiction', '1A', 1, 0, ''), ('nonfiction', '4A', 4, 0, '')`,
  )

  const planks = plankOf()
  await pool.query(
    `INSERT INTO books (title, authors, shelf_range, is_fiction, author_filing, sort_key,
                        location, shelved_at, scanned_at, classification_source,
                        classification_confidence)
     SELECT title, printed, shelf_range, is_fiction, author_filing, sort_key, location,
            '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z', 'auto', 'high'
       FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[],
                   $7::text[])
            WITH ORDINALITY AS seed(title, printed, shelf_range, is_fiction, author_filing,
                                    sort_key, location, at)
      ORDER BY at`,
    [
      LIVE_SIZED.map((book) => book.title),
      LIVE_SIZED.map((book) => book.filesUnder),
      LIVE_SIZED.map((book) => book.range),
      LIVE_SIZED.map((book) => (book.range === 'fiction' ? 1 : 0)),
      LIVE_SIZED.map((book) => book.filesUnder),
      LIVE_SIZED.map((book) => book.sortKey),
      LIVE_SIZED.map((book) => planks.get(book.title) ?? ''),
    ],
  )

  await pool.query(
    `INSERT INTO book_authors (book_id, position, name)
     SELECT b.id, 1, b.authors FROM books b WHERE b.authors <> ''`,
  )

  const boundaries = [...separatorsOf('fiction'), ...separatorsOf('nonfiction')]
  await pool.query(
    `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
     SELECT shelf_range, kind, starts_at, position, '', '2026-01-02T03:04:05.000Z'
       FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
            AS seed(shelf_range, kind, starts_at, position)`,
    [
      boundaries.map((one) => one.range),
      boundaries.map((one) => one.kind),
      boundaries.map((one) => one.startsAt),
      boundaries.map((one) => one.position),
    ],
  )

  return pool
}

// ---------------------------------------------------------------------------
// The two models, each asked where every book is
// ---------------------------------------------------------------------------

/** The shelf order hash, spelled as `server/backup.ts` and `0013` spell it. */
async function shelfOrder(pool: pg.Pool, from: string): Promise<string | null> {
  const { rows } = await pool.query<{ hash: string | null }>(
    `SELECT md5(string_agg(id::text, ',' order by sort_key, id)) AS hash FROM ${from}`,
  )
  return rows[0]?.hash ?? null
}

/**
 * What the ledger says about where every book is, said as the label the wire
 * carries.
 *
 * `withPlacements` is production code and is what every book on the wire is read
 * through once the column has gone, so this compares against the answer the
 * client will actually be given rather than against a query written for a test.
 */
async function fromTheLedger(pool: pg.Pool): Promise<Map<string, string>> {
  const db = new PgDb(pool)
  const { rows } = await pool.query<{ id: number; title: string }>(
    'SELECT id, title FROM catalogued_books ORDER BY id',
  )
  const placed = await withPlacements(db, rows)
  return new Map(placed.map((row) => [row.title, row.location]))
}

/** Every book the two models disagree about, said for a reviewer. */
function disagreements(
  old: Map<string, string>,
  now: Map<string, string>,
  said: (title: string, was: string, is: string) => string,
): string[] {
  const found: string[] = []
  for (const [title, was] of old) {
    const is = now.get(title) ?? ''
    if (is !== was) found.push(said(title, was, is))
  }
  return found.sort()
}

// ---------------------------------------------------------------------------

describe('the rules and the areas deciding where every book goes', () => {
  it('puts every book where the separators put it, and the ledger says so', async () => {
    const pool = await catalogueOf()

    const before = await shelfOrder(pool, 'books WHERE checked_out_at IS NULL')
    // Read while both models are live: the layout the separators produce, and
    // the location column, which is what the client reads today.
    const bySeparators = plankOf()
    const { rows: recorded } = await pool.query<{ title: string; location: string }>(
      'SELECT title, location FROM books ORDER BY id',
    )
    const byColumn = new Map(recorded.map((row) => [row.title, row.location]))

    expect(await migrateToLatest(pool)).toBe('adopted')

    // The shelf, both ways. `areaDisagreements` is production code and is what
    // `applySchema` runs on every start, so this is the check the app makes
    // about itself rather than one written for a test.
    const drift = await areaDisagreements(new PgDb(pool))
    expect(drift.map(describeAreaDisagreement)).toEqual([])

    // And the layout the areas produce really is the layout the separators
    // produced, which `areaDisagreements` cannot say on its own: it compares two
    // readings of the rows as they stand now, and this compares them against
    // what the dropped tables said.
    const byRules = await fromTheLedger(pool)
    expect(byRules.size).toBe(LIVE_SIZED.length)
    expect(disagreements(bySeparators, byRules, (title, was, is) =>
      `${title}: the separators say ${was}, the areas say ${is || 'nowhere'}`)).toEqual([])

    // The record, both ways.
    expect(disagreements(byColumn, byRules, (title, was, is) =>
      `${title}: the column says ${was}, the ledger says ${is || 'nowhere'}`)).toEqual([])

    const after = await shelfOrder(pool, 'shelved_books')
    console.log(`[placement cutover] shelf order ${before} before, ${after} after; ` +
      `${LIVE_SIZED.length} books placed twice and compared one at a time, ` +
      `over ${BOUNDARIES.length} boundaries; 0 named as moving`)
    expect(after).toBe(before)
  })

  /**
   * The refusal that stands between a mistyped label and losing where a book is.
   *
   * `0015` counted these and left them, because `books.location` was still
   * authoritative and the record was safe in the column. It is about to stop
   * being safe anywhere, so `0023` refuses, names the books and says what to do.
   * This is the one guard in the chain that can stop the live catalogue
   * migrating, so it is the one worth watching fire.
   */
  it('refuses rather than losing a book recorded on a plank nobody has', async () => {
    const pool = await catalogueOf()
    await pool.query(
      "UPDATE books SET location = '9Z' WHERE title = 'Book 007'",
    )

    await expect(migrateToLatest(pool)).rejects.toThrow(
      /would lose where 1 books are[\s\S]*Book 007 at 9Z/,
    )

    // Refused, not half done: the column is still there to be read and put right.
    const { rows } = await pool.query<{ location: string }>(
      "SELECT location FROM books WHERE title = 'Book 007'",
    )
    expect(rows[0]!.location).toBe('9Z')
  })

  it('has really dropped the two tables and the three columns', async () => {
    const pool = await catalogueOf()
    await migrateToLatest(pool)

    const { rows: tables } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('separators', 'shelf_ranges')`,
    )
    expect(tables).toEqual([])

    const { rows: columns } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'books'
          AND column_name IN ('location', 'shelved_at', 'checked_out_at')`,
    )
    expect(columns).toEqual([])
  })
})

describe('the comparison failing, which is what makes it worth making', () => {
  /**
   * Moving one anchor is the failure this whole change is about, and it is
   * caught by a different check from the one that catches a drifted model.
   *
   * A boundary that says the wrong thing does not throw and does not fail a
   * smoke test. It draws a plank's worth of books on the plank before, and the
   * only symptom is somebody standing at a bookcase holding a book. What says so
   * is `Shelves.review`, which compares where every book is recorded against
   * where the furniture puts it, and it is a genuinely two-sided comparison
   * still: one side is the ledger and the other is the areas.
   *
   * `areaDisagreements` is deliberately not what catches this, and that is worth
   * writing down rather than discovering. Both of its readings walk the same
   * areas, so moving one moves both. What it catches is the two of them being
   * asked different questions about the same book, which is the second half of
   * this test.
   */
  it('names the books when one anchor moves, and when a run changes hands', async () => {
    const pool = await catalogueOf()
    await migrateToLatest(pool)
    const db = new PgDb(pool)
    const shelves = new Shelves(db)

    expect((await shelves.review('fiction')).misfiles).toEqual([])
    expect(await areaDisagreements(db)).toEqual([])

    // The third plank of the fiction run, anchored eight books earlier. Every
    // book between the two anchors is now drawn on a plank it is not recorded
    // on, which is exactly what somebody moving a divider without carrying the
    // books produces.
    const fiction = inRange('fiction')
    const { rowCount } = await pool.query(
      `UPDATE area SET starts_at = $1
        WHERE id = (SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
                     WHERE f.position = 1 AND a.position = 2)`,
      [fiction[28]!.sortKey],
    )
    expect(rowCount).toBe(1)

    const misfiled = (await shelves.review('fiction')).misfiles
    console.log(`[placement cutover] one anchor moved: ${misfiled.length} books named`)
    for (const one of misfiled.slice(0, 4)) {
      console.log(`[placement cutover]   ${one.book.title}: recorded at ` +
        `${one.book.location}, the areas say ${one.to}`)
    }
    expect(misfiled.map((one) => one.book.title))
      .toEqual(fiction.slice(28, 36).map((book) => book.title))

    // And the other check, which is the one that fails when the range a book
    // files into and the rule that claims it stop saying the same thing.
    expect(await areaDisagreements(db)).toEqual([])
    await pool.query(
      `UPDATE books SET shelf_range = 'nonfiction'
        WHERE title IN ('Book 001', 'Book 002')`,
    )

    const found = await areaDisagreements(db)
    console.log(`[placement cutover] one range column changed: ${found.length} books named`)
    for (const line of found.map(describeAreaDisagreement)) {
      console.log(`[placement cutover]   ${line}`)
    }
    expect(found.map((one) => one.title).sort()).toEqual(['Book 001', 'Book 002'])
  })

  /**
   * Editing one placement is the other failure, and it is the one the column
   * used to make impossible: the ledger and the projection over it disagreeing
   * about the same book.
   */
  it('names the book when one placement is edited', async () => {
    const pool = await catalogueOf()
    await migrateToLatest(pool)

    const before = await fromTheLedger(pool)
    expect(before.get('Book 001')).toBe(plankOf().get('Book 001'))

    // The projection moved and the ledger left where it was, which is exactly
    // what a fifth writer of a location would produce.
    const { rows } = await pool.query<{ id: number }>(
      `SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
        WHERE f.position = 2 AND a.position = 0`,
    )
    await pool.query(
      'UPDATE books SET current_area_id = $1 WHERE title = $2',
      [rows[0]!.id, 'Book 001'],
    )

    const after = await fromTheLedger(pool)
    expect(after.get('Book 001')).not.toBe(before.get('Book 001'))
    console.log('[placement cutover] one placement edited: Book 001 reads ' +
      `${after.get('Book 001')} where the ledger says ${before.get('Book 001')}`)

    // And the check that watches the projection says so, which is the check
    // `applySchema` has run on every start since #185.
    const { rows: drift } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM books b
         LEFT JOIN LATERAL (
           SELECT p.kind, p.area_id FROM book_placement p
            WHERE p.book_id = b.id AND p.kind <> 'assigned'
            ORDER BY p.id DESC LIMIT 1
         ) folded ON true
        WHERE b.current_area_id IS DISTINCT FROM
              (CASE WHEN folded.kind IN ('placed', 'pinned') THEN folded.area_id END)`,
    )
    expect(Number(drift[0]!.n)).toBe(1)
  })
})
