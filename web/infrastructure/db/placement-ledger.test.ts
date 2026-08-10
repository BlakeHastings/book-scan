/**
 * The claim this step rests on, checked book by book.
 *
 * **The ledger, replayed, reproduces `books.location` for every book, and
 * `books.current_area_id` agrees with the ledger for every book.** Not
 * approximately, and not "the counts agree": every catalogued book is folded out
 * of `book_placement` by `domain/placement/ledger.ts`, turned back into a label
 * by `labelFor`, and compared with the column it was built from, one book at a
 * time.
 *
 * That comparison is possible at all because nothing is cut over. `location`,
 * `shelved_at` and `checked_out_at` keep every value and stay authoritative, so
 * both models are live over one catalogue and each can be asked the same
 * question. It is the reason this step adds and backfills rather than replacing,
 * and it is what catches every quiet way this could be wrong:
 *
 * - a label parsed to the wrong plank, which does not fail, it files a run of
 *   books one place along;
 * - a fold that followed `assigned` rows, which would put every book where the
 *   rules want it and make the misfile list empty by construction;
 * - a projection written from the row just inserted rather than from the rows,
 *   which is the same mistake wearing a different hat;
 * - a checked out book keeping an area, which would offer a book in somebody's
 *   bag as the neighbour of one on a shelf.
 *
 * **The projection is the thing that will rot**, so three tests here break it on
 * purpose and watch the check name exactly the books it should.
 *
 * Nothing in this file connects to anything but a scratch database it made, and
 * nothing anywhere here reads, writes or deletes a cover file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  labelFor, slotsInOrder, type Area, type Fixture, type Slot,
} from '../../domain/placement/geography'
import {
  currentAreaOf, standingOf, type Placement,
} from '../../domain/placement/ledger'
import type { PlacementRule } from '../../domain/placement/rules'
import type { SortStrategy } from '../../domain/placement/strategies'
import {
  AssignPlacementsHandler, type AssignableBook,
} from '../../application/placement/assign-placements'
import { PgDb, SCHEMA } from '../../server/db.pg'
import type { Db } from '../../server/driver'
import { layoutRange, type Separator, type SeparatorKind } from '../../shared/layout'
import { DrizzlePlacementLedger } from '../placement/ledger-repository'
import {
  countProjectionDisagreements, projectionDisagreements, rebuildProjection,
} from '../placement/projection'
import { MigrationFailed, migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await dropScratchDatabases()
})

// ---------------------------------------------------------------------------
// A catalogue in the state the owner's is in
// ---------------------------------------------------------------------------

type Range = 'fiction' | 'nonfiction'

interface SeedBook {
  title: string
  sortKey: string
  range: Range
  /** As recorded by a person. Filled in from the layout unless overridden. */
  location?: string
  state?: 'shelved' | 'checked_out' | 'withdrawn' | 'identified'
}

interface SeedSeparator {
  range: Range
  kind: SeparatorKind
  startsAt: string
}

/**
 * The same 236 books and eleven boundaries `placement-backfill.test.ts` uses,
 * which is the size and shape the live catalogue was measured at.
 *
 * Deliberately the same fixture. The two steps are asked the same question about
 * the same arrangement, so a disagreement between them is a disagreement about
 * the model rather than about which catalogue was chosen.
 */
const LIVE_SIZED: SeedBook[] = Array.from({ length: 236 }, (_, at) => ({
  title: `Book ${String(at).padStart(3, '0')}`,
  sortKey: `key-${String(at).padStart(4, '0')}`,
  range: at % 3 === 0 ? ('nonfiction' as const) : ('fiction' as const),
}))

const LIVE_SEPARATORS: SeedSeparator[] = [
  { range: 'fiction', kind: 'area', startsAt: 'key-0022' },
  { range: 'fiction', kind: 'area', startsAt: 'key-0055' },
  { range: 'fiction', kind: 'shelf', startsAt: 'key-0088' },
  { range: 'fiction', kind: 'area', startsAt: 'key-0100' },
  { range: 'fiction', kind: 'area', startsAt: 'key-0100' },
  { range: 'fiction', kind: 'area', startsAt: 'key-0142x' },
  { range: 'fiction', kind: 'shelf', startsAt: 'key-0170' },
  { range: 'fiction', kind: 'area', startsAt: 'key-0205' },
  { range: 'nonfiction', kind: 'area', startsAt: 'key-0072' },
  { range: 'nonfiction', kind: 'area', startsAt: 'key-0150' },
  { range: 'nonfiction', kind: 'area', startsAt: 'key-0213' },
]

const RANGE_STARTS: Record<Range, { shelf: number; area: number }> = {
  fiction: { shelf: 1, area: 0 },
  nonfiction: { shelf: 4, area: 0 },
}

/**
 * Where the app's own layout puts each of these books, which is what a person
 * standing at the shelves would have typed in.
 *
 * Computed with `layoutRange`, the function the running app draws its shelves
 * with, so the recorded locations in this fixture are the ones a real catalogue
 * accumulates rather than ones invented to be easy to parse.
 */
function recordedLocations(books: SeedBook[], separators: SeedSeparator[]): Map<string, string> {
  const placed = new Map<string, string>()

  for (const range of ['fiction', 'nonfiction'] as const) {
    const inRange = books.filter((book) => book.range === range)
    const layout = layoutRange(
      inRange.map((book) => ({ id: 0, title: book.title, sortKey: book.sortKey })),
      separators
        .filter((one) => one.range === range)
        .map((one, at): Separator => ({
          id: at, range, kind: one.kind, startsAt: one.startsAt, position: at,
        })),
      RANGE_STARTS[range],
    )
    for (const one of layout) placed.set(one.book.title, one.label)
  }

  return placed
}

const LIVE_LOCATIONS = recordedLocations(LIVE_SIZED, LIVE_SEPARATORS)

/** The seed, with every book recorded where the layout says it is. */
function asShelved(books: SeedBook[], overrides: Partial<SeedBook>[] = []): SeedBook[] {
  const byTitle = new Map(overrides.map((one) => [one.title, one]))
  return books.map((book) => ({
    ...book,
    location: LIVE_LOCATIONS.get(book.title) ?? '',
    ...byTitle.get(book.title),
  }))
}

/**
 * The catalogue as stage H left it: the pre-Drizzle schema, with the two rows
 * `applySchema` seeds into `shelf_ranges`, and never migrated.
 *
 * `SCHEMA` rather than `applySchema`, for the reason the other backfill tests
 * give: `applySchema` runs the migrations itself and would hand back a database
 * that had already had the ones under test.
 */
async function catalogueOf(
  books: SeedBook[],
  separators: SeedSeparator[],
): Promise<pg.Pool> {
  const pool = await scratchDatabase()
  await pool.query(SCHEMA)

  await pool.query(
    `INSERT INTO shelf_ranges (shelf_range, start_label, start_shelf, start_area, note)
     VALUES ('fiction', '1A', 1, 0, 'Starts on the first bookcase'),
            ('nonfiction', '4A', 4, 0, 'Bookcase 4 is dedicated to non-fiction')`,
  )

  // One statement rather than one per book, for the reason
  // `placement-backfill.test.ts` gives: a round trip per book is 236 of them per
  // database and a dozen databases across a file.
  if (books.length) {
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at,
                          classification_source, classification_confidence,
                          location, shelved_at, checked_out_at)
       SELECT title, shelf_range, is_fiction, sort_key,
              '2026-01-02T03:04:05.000Z', 'auto', 'high',
              location,
              CASE WHEN location <> '' THEN '2026-02-03T04:05:06.000Z' END,
              CASE WHEN state = 'checked_out' THEN '2026-03-04T05:06:07.000Z' END
         FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[])
              WITH ORDINALITY AS seed(title, shelf_range, is_fiction, sort_key,
                                      location, state, at)
        ORDER BY at`,
      [
        books.map((book) => book.title),
        books.map((book) => book.range),
        books.map((book) => (book.range === 'fiction' ? 1 : 0)),
        books.map((book) => book.sortKey),
        books.map((book) => book.location ?? ''),
        books.map((book) => book.state ?? 'shelved'),
      ],
    )
  }

  if (separators.length) {
    await pool.query(
      `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
       SELECT shelf_range, kind, starts_at, position, '', '2026-01-02T03:04:05.000Z'
         FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
              AS seed(shelf_range, kind, starts_at, position)`,
      [
        separators.map((one) => one.range),
        separators.map((one) => one.kind),
        separators.map((one) => one.startsAt),
        separators.map((_, at) => at),
      ],
    )
  }

  return pool
}

/**
 * The states the seed asked for that the baseline schema has no column to hold.
 *
 * `books.state` arrives with `0007`, so `withdrawn` and the queued states cannot
 * be seeded with the rest of the row. `checked_out` needs none of this: `0008`
 * derives it from `checked_out_at`, which the seed does set.
 */
async function withStates(pool: pg.Pool, books: SeedBook[]): Promise<boolean> {
  const stated = books.filter((book) => book.state === 'withdrawn' || book.state === 'identified')
  if (!stated.length) return false

  await pool.query(
    `UPDATE books SET state = seed.state
       FROM unnest($1::text[], $2::text[]) AS seed(title, state)
      WHERE books.title = seed.title`,
    [stated.map((book) => book.title), stated.map((book) => book.state)],
  )
  return true
}

// ---------------------------------------------------------------------------
// Reading the two models back
// ---------------------------------------------------------------------------

/** The furniture and the rules, read out of the rows `0013` wrote. */
async function furnitureIn(pool: pg.Pool): Promise<{ order: Slot[]; rules: PlacementRule[] }> {
  const fixtures = await pool.query<{
    id: number; position: number; kind: string; name: string; sort_strategy: SortStrategy
  }>('SELECT id, position, kind, name, sort_strategy FROM fixture')

  const areas = await pool.query<{
    id: number; fixture_id: number; position: number; name: string;
    starts_at: string; sort_strategy: SortStrategy
  }>('SELECT id, fixture_id, position, name, starts_at, sort_strategy FROM area')

  const rules = await pool.query<{
    id: number; area_id: number | null; fixture_id: number | null;
    priority: number; name: string; enabled: boolean
  }>('SELECT id, area_id, fixture_id, priority, name, enabled FROM placement_rule')

  const conditions = await pool.query<{
    rule_id: number; field: 'tag'; operator: 'is' | 'under'; value: string
  }>('SELECT rule_id, field, operator, value FROM rule_condition ORDER BY id')

  return {
    order: slotsInOrder(
      fixtures.rows.map((row): Fixture => ({
        id: row.id, position: row.position, kind: row.kind, name: row.name,
        sortStrategy: row.sort_strategy,
      })),
      areas.rows.map((row): Area => ({
        id: row.id, fixtureId: row.fixture_id, position: row.position, name: row.name,
        startsAt: row.starts_at, sortStrategy: row.sort_strategy,
      })),
    ),
    rules: rules.rows.map((row): PlacementRule => ({
      id: row.id,
      areaId: row.area_id,
      fixtureId: row.fixture_id,
      priority: row.priority,
      name: row.name,
      enabled: row.enabled,
      conditions: conditions.rows
        .filter((condition) => condition.rule_id === row.id)
        .map(({ field, operator, value }) => ({ field, operator, value })),
    })),
  }
}

interface CatalogueBook {
  id: number
  title: string
  state: string
  location: string
  sortKey: string
  currentAreaId: number | null
}

async function catalogueBooks(pool: pg.Pool): Promise<CatalogueBook[]> {
  const { rows } = await pool.query<{
    id: number; title: string; state: string; location: string | null;
    sort_key: string; current_area_id: number | null
  }>(
    'SELECT id, title, state, location, sort_key, current_area_id FROM books ORDER BY id',
  )
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    state: row.state,
    location: (row.location ?? '').trim(),
    sortKey: row.sort_key,
    currentAreaId: row.current_area_id === null ? null : Number(row.current_area_id),
  }))
}

/** Every row of the ledger, grouped by the book it is about. */
async function ledgerIn(pool: pg.Pool): Promise<Map<number, Placement[]>> {
  const { rows } = await pool.query<{
    id: number; book_id: number; kind: string; area_id: number | null;
    sort_key: string; rule_id: number | null; actor: string; reason: string; created_at: string
  }>('SELECT * FROM book_placement ORDER BY book_id, id')

  const grouped = new Map<number, Placement[]>()
  for (const row of rows) {
    const placement = {
      id: Number(row.id),
      bookId: Number(row.book_id),
      kind: row.kind,
      areaId: row.area_id === null ? null : Number(row.area_id),
      sortKey: row.sort_key,
      ruleId: row.rule_id === null ? null : Number(row.rule_id),
      actor: row.actor,
      reason: row.reason,
      createdAt: row.created_at,
    } as Placement
    const existing = grouped.get(placement.bookId)
    if (existing) existing.push(placement)
    else grouped.set(placement.bookId, [placement])
  }
  return grouped
}

/**
 * Every book whose ledger, replayed, does not say what `books.location` says.
 *
 * The central comparison, and it is deliberately made in TypeScript through the
 * domain fold rather than in SQL: `0015` and `projectionDisagreements` are both
 * SQL, and two SQL statements written from the same paragraph can agree with
 * each other and be wrong together. This one reads the rows and folds them with
 * `standingOf`, which is the definition the schema's check constraint is written
 * from.
 *
 * Three states are compared against nothing rather than against `location`, and
 * each is an exclusion this model makes on purpose:
 *
 * - **checked out**, which holds no position. `books.location` still names the
 *   plank it came off, and `reviewShelving` excludes such a book for exactly the
 *   same reason.
 * - **withdrawn**, which has left the collection.
 * - **queued and discarded**, which have never been anywhere.
 */
function replayDisagreements(
  books: CatalogueBook[],
  ledger: Map<number, Placement[]>,
  labels: Map<number, string>,
): string[] {
  return books.flatMap((book) => {
    const standing = standingOf(ledger.get(book.id) ?? [])
    const replayed = standing.area === null ? '' : labels.get(standing.area) ?? '?'

    if (book.state === 'checked_out' || book.state === 'withdrawn') {
      return replayed === ''
        ? []
        : [`${book.title}: is ${book.state} and the ledger has it at ${replayed}`]
    }
    if (book.state !== 'shelved') {
      return replayed === '' ? [] : [`${book.title}: is ${book.state} and the ledger has it somewhere`]
    }

    return replayed === book.location
      ? []
      : [`${book.title}: books.location says ${book.location || 'nowhere'}, ` +
         `the ledger says ${replayed || 'nowhere'}`]
  })
}

/** Every book whose `current_area_id` is not what its rows fold to. */
function projectionDisagreementsInTypeScript(
  books: CatalogueBook[],
  ledger: Map<number, Placement[]>,
): string[] {
  return books.flatMap((book) => {
    const folded = currentAreaOf(ledger.get(book.id) ?? [])
    return folded === book.currentAreaId
      ? []
      : [`${book.title}: column ${book.currentAreaId ?? 'nowhere'}, ` +
         `ledger ${folded ?? 'nowhere'}`]
  })
}

/** Area id to the label a person reads, which is what `books.location` holds. */
function labelsOf(order: Slot[]): Map<number, string> {
  return new Map(order.map((slot) => [slot.area.id, labelFor(slot)]))
}

/**
 * The shelf order hash, spelled as `server/backup.ts` and the migrations spell
 * it. The relation is named by the caller because there is not one to name on
 * both sides: before the migrations there is no `shelved_books` view.
 */
async function shelfOrder(pool: pg.Pool, from: string): Promise<string | null> {
  const { rows } = await pool.query<{ hash: string | null }>(
    `SELECT md5(string_agg(id::text, ',' order by sort_key, id)) AS hash FROM ${from}`,
  )
  return rows[0]?.hash ?? null
}

/** A migration's file, read from what ships rather than copied into this file. */
function migrationSql(tag: string): string {
  return readFileSync(fileURLToPath(new URL(`./migrations/${tag}.sql`, import.meta.url)), 'utf8')
}

const BACKFILL = '0015_where_every_book_is_becomes_rows'

/**
 * A migrated catalogue, with the states the seed asked for.
 *
 * A state the baseline cannot hold can only be written after the migrations, by
 * which time the backfill has already read the catalogue, so the ledger is taken
 * back off and **the shipped migration is run again** over the corrected rows.
 * Running the file rather than a copy of it is deliberate: a copy is a second
 * thing to keep in step and would go green while the file was wrong.
 */
async function migratedCatalogue(books: SeedBook[]): Promise<pg.Pool> {
  const pool = await catalogueOf(books, LIVE_SEPARATORS)
  await migrateToLatest(pool)

  if (await withStates(pool, books)) {
    await pool.query('DELETE FROM book_placement')
    await pool.query('UPDATE books SET current_area_id = NULL')
    await pool.query(migrationSql(BACKFILL))
  }
  return pool
}

// ---------------------------------------------------------------------------

/**
 * The catalogue every read-only assertion below is made against.
 *
 * **One database for nine tests, and built in a hook.** Each of these is a
 * question about the same backfill over the same catalogue, so nine databases
 * would be nine `CREATE DATABASE`s queueing behind the rest of the suite against
 * one container. `vitest.config.ts` raised `hookTimeout` for exactly that queue
 * and deliberately left `testTimeout` alone, so a database made in a hook waits
 * its turn and one made in a test body fails at five seconds. Two other backfill
 * files were tipped over that way by this one before it was consolidated.
 *
 * Three books carry the arrangements worth asking about: one checked out, one
 * nobody has placed, and one recorded on a plank the furniture does not have.
 * All three are states the baseline schema can hold, so nothing here is rewritten
 * after the migrations and the shelf order hash spans the whole run.
 */
const SEED = asShelved(LIVE_SIZED, [
  { title: 'Book 010', state: 'checked_out' },
  { title: 'Book 012', location: '' },
  { title: 'Book 013', location: '9Z' },
])

describe('where every book is, becoming rows', () => {
  let pool: pg.Pool
  let before: string | null

  beforeAll(async () => {
    pool = await catalogueOf(SEED, LIVE_SEPARATORS)
    before = await shelfOrder(pool, 'books WHERE checked_out_at IS NULL')

    // Adopted, because this database has the baseline tables and has never been
    // migrated. That is the path the real catalogue takes.
    expect(await migrateToLatest(pool)).toBe('adopted')
  }, 60_000)

  it('replays to exactly what books.location says, book by book', async () => {
    const books = await catalogueBooks(pool)
    const ledger = await ledgerIn(pool)
    const labels = labelsOf((await furnitureIn(pool)).order)

    expect(books).toHaveLength(LIVE_SIZED.length)
    /*
     * Every book compared, and the residue written down rather than filtered
     * away. One book disagrees and it is the one recorded on a plank the
     * furniture does not have, which the ledger has no row to point at and
     * `0015` counts on the way in. Asserting the exact list rather than
     * excluding that book keeps the limit visible: if a second kind of book ever
     * stops replaying, this fails with its title in the message.
     */
    expect(replayDisagreements(books, ledger, labels))
      .toEqual(['Book 013: books.location says 9Z, the ledger says nowhere'])
    expect(projectionDisagreementsInTypeScript(books, ledger)).toEqual([])
    expect(await countProjectionDisagreements(new PgDb(pool))).toBe(0)

    // Printed rather than only asserted, because these are the two strings the
    // pull request quotes. The only column this migration writes to `books` is
    // `current_area_id`, which nothing orders by.
    const after = await shelfOrder(pool, 'shelved_books')
    console.log(`[ledger] shelf order ${before} before, ${after} after; ` +
      `${books.length} books replayed across ${new Set(labels.values()).size} areas`)
    expect(after).toBe(before)
  })

  it('lands every one of them on a plank that exists, across both ranges', async () => {
    // The comparison above would pass if both models were wrong the same way.
    // This says what the answers actually are, and it is the same set of labels
    // `placement-backfill.test.ts` asserts the rules produce, which is what makes
    // the two steps comparable. 2B is missing on purpose: two separators on one
    // anchor leave an area with no books on it.
    const labels = labelsOf((await furnitureIn(pool)).order)

    const used = [...new Set(
      (await catalogueBooks(pool))
        .map((book) => book.currentAreaId)
        .filter((id): id is number => id !== null)
        .map((id) => labels.get(id)!),
    )].sort()

    expect(used).toEqual([
      '1A', '1B', '1C', '2A', '2C', '2D', '3A', '3B', '4A', '4B', '4C', '4D',
    ])
  })

  it('writes not one assigned row, because the rules have not run', async () => {
    /*
     * `assigned` is what the rules want, and the rules are TypeScript. `0013`
     * settled that a migration does not reimplement them in SQL, and a backfill
     * that wrote one per book would be exactly the flood the design forbids: a
     * row per book saying nothing changed.
     *
     * 234 placed, not 236: one book nobody has placed and one recorded on a
     * plank that does not exist. The checked out book carries a second row after
     * its placement.
     */
    const counted = await pool.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM book_placement)::text AS rows,
              (SELECT count(*) FROM book_placement WHERE kind = 'assigned')::text AS assigned,
              (SELECT count(*) FROM book_placement WHERE kind = 'placed')::text AS placed,
              (SELECT count(*) FROM book_placement WHERE actor = 'migration')::text AS backfilled`,
    )
    expect(counted.rows[0]).toEqual({
      rows: '235', assigned: '0', placed: '234', backfilled: '235',
    })
  })

  it('takes a checked out book off the shelf, and says so in two rows', async () => {
    /*
     * The one place the ledger deliberately does not reproduce `books.location`.
     * A book in a bag holds no position, so it is nowhere in the ledger while the
     * column still names the plank it came off, and `reviewShelving` excludes
     * such a book from the misfile list for exactly the same reason.
     */
    const out = (await catalogueBooks(pool)).find((book) => book.title === 'Book 010')!
    expect(out.location).not.toBe('')
    expect(out.currentAreaId).toBeNull()
    expect(((await ledgerIn(pool)).get(out.id) ?? []).map((row) => row.kind))
      .toEqual(['placed', 'checked_out'])
  })

  it('gives a book nobody has placed no rows at all', async () => {
    const queued = (await catalogueBooks(pool)).find((book) => book.title === 'Book 012')!
    expect(queued.currentAreaId).toBeNull()
    expect((await ledgerIn(pool)).get(queued.id)).toBeUndefined()
  })

  it('counts a book recorded on a plank the furniture does not have, and places the rest', async () => {
    /*
     * `PATCH /api/books/:id/location` accepts any label `parseLocation` accepts,
     * so `9Z` is a location a person may record and there is no area row for it.
     * Refusing would refuse a catalogue the app already handles, so it is counted
     * and named instead, and the book carries no placed row.
     */
    const stray = (await catalogueBooks(pool)).find((book) => book.title === 'Book 013')!
    expect(stray.location).toBe('9Z')
    expect(stray.currentAreaId).toBeNull()
    expect((await ledgerIn(pool)).get(stray.id)).toBeUndefined()
  })

  it('is not run twice on a database that has already had it', async () => {
    const rows = await ledgerIn(pool)

    expect(await migrateToLatest(pool)).toBe('migrated')

    // And run again by hand, which is the belt to the migrator's braces: a
    // migration somebody is not sure finished should be safe to set going again.
    // Without the guard a second run would double every book's history and the
    // fold would still look right, which is the worst kind of wrong.
    await pool.query(migrationSql(BACKFILL))

    const after = await ledgerIn(pool)
    expect([...after.keys()]).toEqual([...rows.keys()])
    expect([...after.values()].flat()).toEqual([...rows.values()].flat())
  })
})

describe('a book that has left the collection', () => {
  let pool: pg.Pool

  // Its own database, because `withdrawn` is a state the baseline schema has no
  // column for: it can only be written after the migrations, by which time the
  // backfill has read the catalogue, so this one has the shipped migration run
  // again over the corrected rows.
  beforeAll(async () => {
    pool = await migratedCatalogue(asShelved(LIVE_SIZED, [
      { title: 'Book 011', state: 'withdrawn' },
    ]))
  }, 60_000)

  it('is nowhere, after the placement that says where it used to be', async () => {
    const gone = (await catalogueBooks(pool)).find((book) => book.title === 'Book 011')!
    expect(gone.currentAreaId).toBeNull()
    expect(((await ledgerIn(pool)).get(gone.id) ?? []).map((row) => row.kind))
      .toEqual(['placed', 'withdrawn'])
  })

  it('leaves every other book replaying to what books.location says', async () => {
    const books = await catalogueBooks(pool)
    const ledger = await ledgerIn(pool)
    expect(replayDisagreements(books, ledger, labelsOf((await furnitureIn(pool)).order)))
      .toEqual([])
    expect(projectionDisagreementsInTypeScript(books, ledger)).toEqual([])
  })
})

describe('a catalogue with nothing in it to record', () => {
  let empty: pg.Pool
  let fresh: pg.Pool

  beforeAll(async () => {
    empty = await catalogueOf([], [])
    expect(await migrateToLatest(empty)).toBe('adopted')

    // The case every developer, every CI run and every end to end run takes, and
    // the one `0013` originally got wrong by reading a table that was empty at
    // the moment it ran.
    fresh = await scratchDatabase()
    expect(await migrateToLatest(fresh)).toBe('created')
  }, 60_000)

  it('writes no rows for a catalogue of no books', async () => {
    const counted = await empty.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM book_placement',
    )
    expect(counted.rows[0]!.n).toBe('0')
  })

  it('builds the ledger on a database created from nothing, not only an adopted one', async () => {
    expect(await countProjectionDisagreements(new PgDb(fresh))).toBe(0)
  })
})

describe('a catalogue this migration will not finish on', () => {
  let pool: pg.Pool
  let refusal: unknown

  beforeAll(async () => {
    pool = await catalogueOf(
      LIVE_SIZED.slice(0, 3).map((book) => ({ ...book, location: '9Z' })),
      [],
    )
    refusal = await migrateToLatest(pool).then(() => undefined, (error: unknown) => error)
  }, 60_000)

  it('refuses when not one recorded location names an area', () => {
    /*
     * The guard `0013` did not have until it was found to have quietly built
     * nothing. A person mistypes a location now and then; all of them at once is
     * this migration failing to read a label, and without this it would add up
     * perfectly, write an empty ledger and say so only in a NOTICE.
     */
    expect(refusal).toBeInstanceOf(MigrationFailed)
    expect((refusal as MigrationFailed).message)
      .toContain('could not place a single book: 3 recorded locations')
    expect((refusal as MigrationFailed).message).toContain(`${BACKFILL}.sql`)
  })

  it('leaves nothing half done to unpick', async () => {
    const table = await pool.query<{ table: string | null }>(
      "SELECT to_regclass('public.book_placement')::text AS table",
    )
    expect(table.rows[0]?.table).toBeNull()
  })
})

describe('the checks, proving they can fail', () => {
  let moved: pg.Pool
  let edited: pg.Pool
  let deleted: pg.Pool

  // Three databases because each test damages the model differently and a
  // repair between them would be a fourth thing to get right, and all three in
  // one hook because a `CREATE DATABASE` queues behind the rest of the suite.
  beforeAll(async () => {
    moved = await migratedCatalogue(asShelved(LIVE_SIZED))
    edited = await migratedCatalogue(asShelved(LIVE_SIZED))
    deleted = await migratedCatalogue(asShelved(LIVE_SIZED))
  }, 120_000)

  it('names the book when one ledger row is moved to another plank', async () => {
    /*
     * The sharpest of the quiet failures: a book the ledger has one plank away
     * from where the catalogue has it. Nothing throws, the book still has a
     * place, and a shelf drawn from the projection would be wrong by one run of
     * books.
     */
    const labels = labelsOf((await furnitureIn(moved)).order)
    const target = [...labels].find(([, label]) => label === '1B')![0]

    expect(replayDisagreements(
      await catalogueBooks(moved), await ledgerIn(moved), labels,
    )).toEqual([])

    await moved.query(
      `UPDATE book_placement SET area_id = $1
        WHERE book_id = (SELECT id FROM books WHERE title = 'Book 001')`,
      [target],
    )

    expect(replayDisagreements(await catalogueBooks(moved), await ledgerIn(moved), labels))
      .toEqual(['Book 001: books.location says 1A, the ledger says 1B'])
  })

  it('names the book when the projection is edited behind the ledger’s back', async () => {
    // The rot this projection exists to be watched for: a `current_area_id` that
    // no longer folds out of the rows. It is a plausible answer rather than an
    // error, so nothing else in the system would ever notice.
    const db: Db = new PgDb(edited)
    expect(await countProjectionDisagreements(db)).toBe(0)

    await edited.query(
      `UPDATE books SET current_area_id = (SELECT min(id) FROM area)
        WHERE title = 'Book 200'`,
    )

    expect(await countProjectionDisagreements(db)).toBe(1)
    const named = await projectionDisagreements(db)
    expect(named.map((one) => one.title)).toEqual(['Book 200'])
    expect(projectionDisagreementsInTypeScript(
      await catalogueBooks(edited), await ledgerIn(edited),
    )).toHaveLength(1)

    // And the repair puts it back, which is what makes the projection a
    // denormalisation rather than a second source of truth: it holds nothing the
    // ledger does not.
    expect(await rebuildProjection(db)).toBe(1)
    expect(await countProjectionDisagreements(db)).toBe(0)
  })

  it('names every book when a whole run of placements is deleted', async () => {
    // The other direction: rows gone rather than rows wrong. Append only is a
    // rule about the writers, not something the database enforces, so the check
    // has to survive somebody breaking it.
    const db: Db = new PgDb(deleted)

    await deleted.query(
      `DELETE FROM book_placement
        WHERE book_id IN (SELECT id FROM books WHERE title IN ('Book 001', 'Book 002'))`,
    )

    expect(await countProjectionDisagreements(db)).toBe(2)
    const found = replayDisagreements(
      await catalogueBooks(deleted), await ledgerIn(deleted),
      labelsOf((await furnitureIn(deleted)).order),
    )
    expect(found).toEqual([
      'Book 001: books.location says 1A, the ledger says nowhere',
      'Book 002: books.location says 1A, the ledger says nowhere',
    ])
  })
})

describe('running the rules over the ledger', () => {
  /**
   * Every shelved book with the tags a rule asks about, which is what the engine
   * is handed.
   */
  async function assignable(pool: pg.Pool): Promise<AssignableBook[]> {
    const { rows } = await pool.query<{ id: number; sort_key: string; slugs: string[] }>(
      `SELECT b.id, b.sort_key, array_remove(array_agg(t.slug), NULL) AS slugs
         FROM shelved_books b
         LEFT JOIN book_tag bt ON bt.book_id = b.id
         LEFT JOIN tag t ON t.id = bt.tag_id
        GROUP BY b.id, b.sort_key
        ORDER BY b.id`,
    )
    return rows.map((row) => ({ id: Number(row.id), sortKey: row.sort_key, tagSlugs: row.slugs }))
  }

  let settled: pg.Pool
  let misfiled: pg.Pool
  let pinned: pg.Pool

  // Three, and in a hook, for the reason the corruption tests above are: each of
  // these writes to the ledger, so they cannot share, and a `CREATE DATABASE` in
  // a test body fails at five seconds when the suite is under load.
  beforeAll(async () => {
    settled = await migratedCatalogue(asShelved(LIVE_SIZED))
    misfiled = await migratedCatalogue(asShelved(LIVE_SIZED, [
      { title: 'Book 001', location: '3B' },
    ]))
    pinned = await migratedCatalogue(asShelved(LIVE_SIZED, [
      { title: 'Book 001', location: '3B' },
    ]))
  }, 120_000)

  it('writes an assignment only where the rules disagree with the room', async () => {
    /*
     * The claim that is easy to get subtly wrong, checked by counting rather than
     * by reading the code. The seeded catalogue is filed exactly as its rules
     * would file it, so a correct engine writes **nothing at all** over 236
     * books, and the ledger is the same size afterwards.
     *
     * An engine comparing the wrong two things would write 236 rows here, which
     * is the flood that makes a ledger useless as history.
     */
    const db: Db = new PgDb(settled)
    const { order, rules } = await furnitureIn(settled)
    const handler = new AssignPlacementsHandler(new DrizzlePlacementLedger(db))

    const report = await handler.handle({
      books: await assignable(settled), rules, order, actor: 'rules',
      now: '2026-08-09T12:00:00.000Z',
    })

    expect(report).toEqual({ assigned: 0, unchanged: 236, skipped: 0, unclaimed: [] })
    const counted = await settled.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM book_placement',
    )
    expect(counted.rows[0]!.n).toBe('236')
  })

  it('writes one for a misfiled book, and does not write it again', async () => {
    /*
     * A book somebody put on the wrong plank. The rules want it back where its
     * sort key says, so one row is written and the book is now reported as
     * needing attention by the model rather than by a computation beside it.
     *
     * The second run is the point: nobody has carried the book, the answer has
     * not changed, and an engine that compared only against the placement would
     * write the same assignment again on every run for as long as the book sits
     * there.
     */
    const db: Db = new PgDb(misfiled)
    const { order, rules } = await furnitureIn(misfiled)
    const handler = new AssignPlacementsHandler(new DrizzlePlacementLedger(db))

    const books = await assignable(misfiled)
    const first = await handler.handle({
      books, rules, order, actor: 'rules', now: '2026-08-09T12:00:00.000Z',
    })
    expect(first.assigned).toBe(1)

    const second = await handler.handle({
      books, rules, order, actor: 'rules', now: '2026-08-09T13:00:00.000Z',
    })
    expect(second).toEqual({ assigned: 0, unchanged: 236, skipped: 0, unclaimed: [] })

    const moved = (await catalogueBooks(misfiled)).find((book) => book.title === 'Book 001')!
    const rows = (await ledgerIn(misfiled)).get(moved.id)!
    expect(rows.map((row) => row.kind)).toEqual(['placed', 'assigned'])
    // The assignment moved nothing: the book is still where the person put it,
    // which is what makes the disagreement the misfile list.
    expect(moved.currentAreaId).toBe(rows[0]!.areaId)
    expect(await countProjectionDisagreements(db)).toBe(0)
  })

  it('leaves a pinned book alone, however wrong the rules think it is', async () => {
    // A pin beats every rule, forever. The engine skips a book whose latest row
    // is a pin, and unpinning is another row rather than a flag anybody clears.
    const db: Db = new PgDb(pinned)
    const { order, rules } = await furnitureIn(pinned)
    const ledger = new DrizzlePlacementLedger(db)

    const stays = (await catalogueBooks(pinned)).find((book) => book.title === 'Book 001')!
    const wrongPlank = [...labelsOf(order)].find(([, label]) => label === '3B')![0]
    await ledger.record({
      bookId: stays.id, kind: 'pinned', areaId: wrongPlank, sortKey: stays.sortKey,
      actor: 'person', reason: 'it lives here', createdAt: '2026-08-09T11:00:00.000Z',
    })

    const report = await new AssignPlacementsHandler(ledger).handle({
      books: await assignable(pinned), rules, order, actor: 'rules',
      now: '2026-08-09T12:00:00.000Z',
    })

    expect(report.skipped).toBe(1)
    expect(report.assigned).toBe(0)
    const rows = (await ledgerIn(pinned)).get(stays.id)!
    expect(rows.map((row) => row.kind)).toEqual(['placed', 'pinned'])
  })
})
