/**
 * The claim this whole step rests on, checked book by book.
 *
 * **The new model, applied to a catalogue, assigns every book to exactly the
 * area the current separators put it in.** Not approximately, and not "the
 * counts agree": every shelved book is placed twice, once by the code the app
 * runs today and once by the rows `0013` wrote, and the two answers are compared
 * one book at a time.
 *
 * That comparison is possible at all because nothing is cut over. `shelf_ranges`
 * and `separators` keep every row and stay authoritative, so both models are
 * live over one catalogue and each can be asked the same question. It is the
 * reason this step adds and backfills rather than replacing, and it is the check
 * that catches every quiet way this could be wrong:
 *
 * - a boundary walked in the wrong order, so one plank's books draw on another;
 * - `area.starts_at` without `COLLATE "C"`, which does not fail, it reorders;
 * - the two genre rules claiming not quite the books `books.is_fiction` does,
 *   which sends a book to a different bookcase;
 * - two areas on one anchor, which a boundary move that emptied an area leaves
 *   behind, stepped over once instead of twice.
 *
 * A check nobody has watched fail is not a check, so three tests here break the
 * model on purpose and watch the comparison name exactly the books it should.
 *
 * **The comparison is `areaDisagreements`, which is production code** and is run
 * on every start by `applySchema`. It was local to this file until #213, which
 * is the defect that says why it could not stay: the claim above holds at the
 * moment of the backfill and expires the first time anybody moves a divider, so
 * a comparison that only a migration's test can make is a comparison about a
 * catalogue that no longer exists. The last describe here moves dividers and
 * asks it again.
 *
 * Nothing in this file connects to anything but a scratch database it made, and
 * nothing anywhere here reads, writes or deletes a cover file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import {
  labelFor, slotsInOrder, type Area, type Fixture, type Slot,
} from '../../domain/placement/geography'
import { placementOf, type PlacementRule } from '../../domain/placement/rules'
import type { SortStrategy } from '../../domain/placement/strategies'
import { PgDb, SCHEMA } from '../../server/db.pg'
import { Shelves } from '../../server/shelves'
import { areaDisagreements, describeAreaDisagreement } from '../shelving/area-drift'
import { DrizzleSeparatorRepository } from '../shelving/separator-repository'
import type { SeparatorKind } from '../../shared/layout'
import { MigrationFailed, migrateToLatest } from './migrate'
import { dropScratchDatabases, scratchDatabase } from './testdb'

afterAll(async () => {
  await dropScratchDatabases()
}, 60_000)

// ---------------------------------------------------------------------------
// A catalogue in the state the owner's is in
// ---------------------------------------------------------------------------

type Range = 'fiction' | 'nonfiction'

interface SeedBook {
  title: string
  sortKey: string
  range: Range
}

interface SeedSeparator {
  range: Range
  kind: SeparatorKind
  startsAt: string
}

/**
 * 236 books, which is what the live catalogue held when #192 measured it, and
 * eleven separators, which is what `server/backup.test.ts` records it having.
 *
 * Every third book is non-fiction, so both ranges are populated and the
 * interesting failure, a migration that gets the big range right and the other
 * one wrong, has somewhere to show up.
 */
const LIVE_SIZED: SeedBook[] = Array.from({ length: 236 }, (_, at) => ({
  title: `Book ${String(at).padStart(3, '0')}`,
  sortKey: `key-${String(at).padStart(4, '0')}`,
  range: at % 3 === 0 ? ('nonfiction' as const) : ('fiction' as const),
}))

/**
 * Eleven boundaries, including the three arrangements that are easy to get
 * wrong.
 *
 * - **Two on one anchor** (`key-0100` twice): what a boundary move that empties
 *   an area leaves behind. A walk that steps over one of them puts a plank's
 *   worth of books one place to the left.
 * - **An anchor no book has** (`key-0142x`): the book it named was deleted, and
 *   the boundary still describes the right *place*.
 * - **A bookcase break and a plank break beside each other**, so the fixture and
 *   the area have to be counted separately.
 */
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

/**
 * The catalogue as stage H left it: the pre-Drizzle schema, with the two rows
 * `applySchema` seeds into `shelf_ranges`, and never migrated.
 *
 * `SCHEMA` rather than `applySchema`, for the reason `state-backfill.test.ts`
 * gives: `applySchema` runs the migrations itself and would hand back a database
 * that had already had the one under test.
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

  /*
   * One statement each rather than one per row. A round trip per book is 236 of
   * them per database and a dozen databases across this file, which is enough
   * to put it, `state-backfill.test.ts` and `capture-backfill.test.ts` over
   * vitest's five second default between them when the suite is under load.
   *
   * `unnest` keeps it parameterised, so the seed is still data rather than
   * built SQL. `WITH ORDINALITY` and the `ORDER BY` are what make the ids
   * follow the array, which two assertions here read: the lowest id is
   * `Book 000`.
   */
  if (books.length) {
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at,
                          classification_source, classification_confidence)
       SELECT title, shelf_range, is_fiction, sort_key,
              '2026-01-02T03:04:05.000Z', 'auto', 'high'
         FROM unnest($1::text[], $2::text[], $3::int[], $4::text[])
              WITH ORDINALITY AS seed(title, shelf_range, is_fiction, sort_key, at)
        ORDER BY at`,
      [
        books.map((book) => book.title),
        books.map((book) => book.range),
        books.map((book) => (book.range === 'fiction' ? 1 : 0)),
        books.map((book) => book.sortKey),
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
 * A second genre tag on one book, in a database that has already been migrated.
 *
 * This is what a book corrected before #201 carries: the old book's genre tag
 * left beside the new one. It is written straight into the tables because no
 * code path produces one any more, and it is written **after** the migration
 * because the tag tables do not exist before it. See "One repair the cut-over
 * owes" in docs/data-model.md.
 */
async function alsoTagged(pool: pg.Pool, title: string, slug: string): Promise<void> {
  await pool.query(
    `INSERT INTO book_tag (book_id, tag_id, source, confidence, added_at)
     SELECT b.id, t.id, 'person', 'high', '2026-03-01T00:00:00.000Z'
       FROM books b, tag t
      WHERE b.title = $1 AND t.slug = $2`,
    [title, slug],
  )
}

// ---------------------------------------------------------------------------
// The two models, each asked where every book goes
// ---------------------------------------------------------------------------

interface Placement {
  id: number
  title: string
  label: string
}

/** The furniture and the rules, read back out of the rows `0013` wrote. */
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

  const order = slotsInOrder(
    fixtures.rows.map((row): Fixture => ({
      id: row.id, position: row.position, kind: row.kind, name: row.name,
      sortStrategy: row.sort_strategy,
    })),
    areas.rows.map((row): Area => ({
      id: row.id, fixtureId: row.fixture_id, position: row.position, name: row.name,
      startsAt: row.starts_at, sortStrategy: row.sort_strategy,
    })),
  )

  return {
    order,
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

/** Every shelved book, with the tags a rule asks about. */
async function shelvedBooks(pool: pg.Pool) {
  const { rows } = await pool.query<{
    id: number; title: string; sort_key: string; is_fiction: number; slugs: string[]
  }>(
    `SELECT b.id, b.title, b.sort_key, b.is_fiction,
            array_remove(array_agg(t.slug), NULL) AS slugs
       FROM shelved_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      GROUP BY b.id, b.title, b.sort_key, b.is_fiction
      ORDER BY b.id`,
  )
  return rows
}

/** Where the rules and the areas put every book, run through the domain. */
async function underRules(pool: pg.Pool): Promise<Placement[]> {
  const { order, rules } = await furnitureIn(pool)

  return (await shelvedBooks(pool)).map((row) => {
    const found = placementOf({ sortKey: row.sort_key, tagSlugs: row.slugs }, rules, order)
    return {
      id: row.id,
      title: row.title,
      // Empty rather than thrown, so a book the rules cannot place shows up in
      // the comparison as a disagreement instead of stopping the run.
      label: found ? labelFor(found.slot) : '',
    }
  })
}

/**
 * The books the two models disagree about, said the way a reviewer reads it.
 *
 * The comparison itself is `areaDisagreements`, in
 * `infrastructure/shelving/area-drift.ts`, which is what `applySchema` runs on
 * every start. This is the one line of formatting the assertions read.
 */
async function disagreements(pool: pg.Pool): Promise<string[]> {
  return (await areaDisagreements(new PgDb(pool))).map(describeAreaDisagreement)
}

/**
 * The shelf order hash, spelled as `server/backup.ts` and `0013` spell it.
 *
 * The relation is named by the caller because there is not one to name on both
 * sides: before the migrations there is no `shelved_books` view, and the shelf
 * was `checked_out_at IS NULL` over `books`. Those are the same rows, which is
 * the point of taking the hash at all.
 */
async function shelfOrder(pool: pg.Pool, from: string): Promise<string | null> {
  const { rows } = await pool.query<{ hash: string | null }>(
    `SELECT md5(string_agg(id::text, ',' order by sort_key, id)) AS hash FROM ${from}`,
  )
  return rows[0]?.hash ?? null
}

/** The last statement of a migration, which is where its guard lives. */
function guardOf(tag: string): string {
  const path = fileURLToPath(new URL(`./migrations/${tag}.sql`, import.meta.url))
  const statements = readFileSync(path, 'utf8').split('--> statement-breakpoint')
  return statements[statements.length - 1]!
}

// ---------------------------------------------------------------------------

describe('the shelves becoming fixtures, areas and rules', () => {
  it('puts every book in exactly the area the separators put it in', async () => {
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)

    const before = await shelfOrder(pool, 'books WHERE checked_out_at IS NULL')
    // Adopted, because this database has the baseline tables and has never been
    // migrated. That is the path the real catalogue takes.
    expect(await migrateToLatest(pool)).toBe('adopted')

    const now = await underRules(pool)

    expect(now).toHaveLength(LIVE_SIZED.length)
    expect(await disagreements(pool)).toEqual([])

    // Printed rather than only asserted, because these are the two strings the
    // pull request quotes. Nothing in `0013` writes to `books`, so they are the
    // same string, read through the view afterwards and through the condition
    // that view replaced before.
    const after = await shelfOrder(pool, 'shelved_books')
    console.log(`[placement] shelf order ${before} before, ${after} after; ` +
      `${now.length} books compared across ${new Set(now.map((one) => one.label)).size} areas`)
    expect(after).toBe(before)
  })

  it('lands every one of them on a plank that exists, across both ranges', async () => {
    /*
     * The comparison above would pass if both models were wrong the same way.
     * This says what the answers actually are: fiction fills bookcases 1 to 3
     * and non-fiction begins on bookcase 4, which is what `start_shelf` has
     * always meant.
     *
     * **2B is missing on purpose**, and it is the emptied area: the two
     * separators on `key-0100` leave an area with no books between them, which
     * is exactly what a boundary move that emptied a plank leaves behind. It has
     * a row in `area` and nothing on it, and a model that stepped over one of
     * those two anchors instead of both would put the whole of 2C on it.
     */
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)

    const labels = [...new Set((await underRules(pool)).map((one) => one.label))].sort()
    expect(labels).toEqual([
      '1A', '1B', '1C', '2A', '2C', '2D', '3A', '3B', '4A', '4B', '4C', '4D',
    ])
  })

  it('makes one fixture per bookcase, one area per boundary and one rule per range', async () => {
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)

    const counted = await pool.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM fixture)::text AS fixtures,
              (SELECT count(*) FROM area)::text AS areas,
              (SELECT count(*) FROM placement_rule)::text AS rules,
              (SELECT count(*) FROM rule_condition)::text AS conditions,
              (SELECT count(*) FROM collection)::text AS collections`,
    )
    // Two bookcase breaks in fiction, so bookcases 1, 2 and 3, plus
    // non-fiction's own. Every separator is an area and every range begins in
    // one more.
    expect(counted.rows[0]).toEqual({
      fixtures: '4',
      areas: String(LIVE_SEPARATORS.length + 2),
      rules: '2',
      conditions: '2',
      collections: '1',
    })

    const rules = await pool.query<{ name: string; priority: number; value: string; position: number }>(
      `SELECT r.name, r.priority, c.value, f.position
         FROM placement_rule r
         JOIN rule_condition c ON c.rule_id = r.id
         JOIN fixture f ON f.id = r.fixture_id
        ORDER BY r.priority`,
    )
    // A fixture rule, not an area rule: it names where the run begins and the
    // run flows on through the bookcases after it.
    expect(rules.rows).toEqual([
      { name: 'Fiction', priority: 1, value: 'genre/fiction', position: 1 },
      { name: 'Non-fiction', priority: 2, value: 'genre/non-fiction', position: 4 },
    ])
  })

  it('reproduces books.is_fiction exactly, rather than approximately', async () => {
    /*
     * The defect this step could have that nobody would see. `books.is_fiction`
     * still decides `shelf_range`, and the two rules are written against the
     * tags `0002` derived from that column, so a book the rules and the column
     * disagree about is a book that files into a different bookcase.
     *
     * Asked of the rule rather than of the label, because that is what the rule
     * decides: which run the book joins.
     */
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)

    const { order, rules } = await furnitureIn(pool)
    const wrong = (await shelvedBooks(pool)).filter((row) => {
      const found = placementOf({ sortKey: row.sort_key, tagSlugs: row.slugs }, rules, order)
      return found?.rule.name !== (row.is_fiction === 1 ? 'Fiction' : 'Non-fiction')
    })
    expect(wrong.map((row) => row.title)).toEqual([])
  })

  it('is not run twice on a database that has already had it', async () => {
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)
    const placed = await underRules(pool)

    expect(await migrateToLatest(pool)).toBe('migrated')
    expect(await underRules(pool)).toEqual(placed)

    // And run again by hand, which is the belt to the migrator's braces: a
    // migration somebody is not sure finished should be safe to set going
    // again, and this one answers by finding the fixtures already there. A
    // second run without that guard would duplicate every fixture, area and
    // rule, and the duplicates would claim the same books.
    await pool.query(guardOf('0013_the_shelves_become_fixtures_and_rules'))
    expect(await underRules(pool)).toEqual(placed)

    const counted = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM fixture')
    expect(counted.rows[0]!.n).toBe('4')
  })

  it('builds the furniture on a database created from nothing, not only an adopted one', async () => {
    /*
     * The case every developer, every CI run and every end to end run takes, and
     * the one this migration originally got wrong.
     *
     * `applySchema` seeds `shelf_ranges` **after** running the migrations,
     * because on an empty database the table does not exist until the baseline
     * has created it. So a walk that read `shelf_ranges` found nothing, built
     * nothing, added up correctly and finished quietly, and every test here
     * passed because the fixture seeds the ranges first, the way an adopted
     * catalogue already has them. It was found by starting the app and reading
     * the rows.
     */
    const pool = await scratchDatabase()
    expect(await migrateToLatest(pool)).toBe('created')

    const rules = await pool.query<{ name: string; position: number }>(
      `SELECT r.name, f.position FROM placement_rule r
         JOIN fixture f ON f.id = r.fixture_id ORDER BY r.priority`,
    )
    expect(rules.rows).toEqual([
      { name: 'Fiction', position: 1 },
      { name: 'Non-fiction', position: 4 },
    ])
    const areas = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM area')
    expect(areas.rows[0]!.n).toBe('2')
  })

  it('says nothing about a catalogue with no books and no boundaries in it', async () => {
    const pool = await catalogueOf([], [])
    expect(await migrateToLatest(pool)).toBe('adopted')
    // Two ranges, so two fixtures, the area each one begins in, and two rules
    // with nothing to claim.
    const counted = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM area')
    expect(counted.rows[0]!.n).toBe('2')
    expect(await underRules(pool)).toEqual([])
  })
})

describe('the comparison, proving it can fail', () => {
  it('names the book that crossed when one anchor moves by one book', async () => {
    /*
     * The sharpest of the quiet failures: an area anchored one book out. The
     * catalogue still works, every book still has a plank, and a run of books is
     * on the wrong one. Move a single `starts_at` back by one book and the
     * comparison names exactly the book that crossed.
     */
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)
    expect(await disagreements(pool)).toEqual([])

    await pool.query("UPDATE area SET starts_at = 'key-0020' WHERE starts_at = 'key-0022'")

    expect(await disagreements(pool))
      .toEqual(['Book 020: separators say 1A, rules say 1B'])
  })

  it('names the books two rules both claim when their priorities are swapped', async () => {
    /*
     * `priority` decides which of two rules claiming one book wins, and the
     * books both rules claim are the ones #201 stopped happening: correcting an
     * ISBN used to leave the old book's genre tag beside the new one.
     *
     * On the catalogue above there are none, so a swap moves nothing, and a
     * demonstration there would prove only that the check was asleep. Here are
     * two such books, and reversing the priorities carries both of them off
     * bookcase 1 and onto bookcase 4.
     */
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)
    await alsoTagged(pool, 'Book 040', 'genre/non-fiction')
    await alsoTagged(pool, 'Book 041', 'genre/non-fiction')

    // As it stands, fiction is rule 1, so a doubly tagged fiction book files as
    // fiction and agrees with `books.is_fiction`. That is the migration's own
    // NOTICE turned into an assertion.
    expect(await disagreements(pool)).toEqual([])

    await pool.query("UPDATE placement_rule SET priority = 3 WHERE name = 'Fiction'")

    expect(await disagreements(pool)).toEqual([
      'Book 040: separators say 1B, rules say 4A',
      'Book 041: separators say 1B, rules say 4A',
    ])
  })

  it('names a whole range when its rule stops claiming it', async () => {
    // What "fiction and non-fiction are two rules now" costs if a rule is
    // written against a slug nothing carries: an entire range with nowhere to
    // go, and not one error anywhere.
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)

    await pool.query(
      "UPDATE rule_condition SET value = 'genre/reference' WHERE value = 'genre/non-fiction'",
    )

    const found = await disagreements(pool)
    expect(found).toHaveLength(LIVE_SIZED.filter((book) => book.range === 'nonfiction').length)
    expect(found[0]).toBe('Book 000: separators say 4A, rules say nowhere')
  })
})

describe('a catalogue this migration will not finish on', () => {
  it('refuses a shelved book that carries no genre tag, and says what that means', async () => {
    const pool = await catalogueOf(LIVE_SIZED.slice(0, 3), [])
    await migrateToLatest(pool)

    // The furniture taken back off so the guard runs against a catalogue it has
    // not seen, and one book's genre tag taken off with it. The guard is read
    // out of the shipped file rather than copied here, because a copy is a
    // second thing to keep in step and would go green while the file was wrong.
    await pool.query('DELETE FROM collection')
    await pool.query('DELETE FROM book_tag WHERE book_id = (SELECT min(id) FROM books)')

    await expect(pool.query(guardOf('0013_the_shelves_become_fixtures_and_rules')))
      .rejects.toThrow(/would have left 1 of 3 shelved books with no rule to claim them/)
  })

  it('refuses a shelf range it has no tag for, rather than writing a rule that matches nothing', async () => {
    const pool = await catalogueOf(LIVE_SIZED.slice(0, 3), [])
    await pool.query(
      `INSERT INTO shelf_ranges (shelf_range, start_label, start_shelf, start_area, note)
       VALUES ('reference', '7A', 7, 0, '')`,
    )

    const refusal = await migrateToLatest(pool).then(() => undefined, (error: unknown) => error)
    expect(refusal).toBeInstanceOf(MigrationFailed)
    expect((refusal as MigrationFailed).message)
      .toContain('shelf range reference has no tag to write a placement rule against')
    expect((refusal as MigrationFailed).message)
      .toContain('0013_the_shelves_become_fixtures_and_rules.sql')

    // Refused rather than half done, so there is nothing to unpick.
    const table = await pool.query<{ table: string | null }>(
      "SELECT to_regclass('public.fixture')::text AS table",
    )
    expect(table.rows[0]?.table).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The same comparison, after somebody moves a divider
// ---------------------------------------------------------------------------

/**
 * The claim above expires the moment the shelves change, which is #213.
 *
 * Every test here starts from the backfilled catalogue, changes a boundary the
 * way the app does, and asks the same book-by-book question again. The first one
 * is the control: a boundary written **around** the repository is the defect,
 * and it has to be watched failing or nothing below means anything.
 */
describe('the areas following the separators after a divider moves', () => {
  /** A catalogue with the furniture built, and the thing that changes it. */
  async function backfilled(): Promise<{ pool: pg.Pool; boundaries: DrizzleSeparatorRepository }> {
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)
    return { pool, boundaries: new DrizzleSeparatorRepository(new PgDb(pool)) }
  }

  const counted = async (pool: pg.Pool, table: 'area' | 'fixture'): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)
    return Number(rows[0]!.n)
  }

  const boundaryAt = async (
    pool: pg.Pool,
    anchor: string,
    kind: SeparatorKind = 'area',
  ): Promise<number> => {
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM separators WHERE starts_at = $1 AND kind = $2 ORDER BY id LIMIT 1',
      [anchor, kind],
    )
    return rows[0]!.id
  }

  /** How many areas each bookcase carries, which is the shape a walk produces. */
  const shape = async (pool: pg.Pool): Promise<Record<string, number>> => {
    const { rows } = await pool.query<{ position: number; n: string }>(
      `SELECT f.position, count(a.id)::text AS n
         FROM fixture f LEFT JOIN area a ON a.fixture_id = f.id
        GROUP BY f.position ORDER BY f.position`,
    )
    return Object.fromEntries(rows.map((row) => [String(row.position), Number(row.n)]))
  }

  const added = (range: Range, kind: SeparatorKind, startsAt: string, position: number) => ({
    range,
    kind,
    startsAt,
    position,
    note: '',
    createdAt: '2026-08-09T00:00:00.000Z',
  })

  /** Fiction books from an anchor on, which is the stretch a boundary shifts. */
  const fictionFrom = (from: string, until?: string) =>
    LIVE_SIZED.filter((book) => book.range === 'fiction'
      && book.sortKey >= from
      && (until === undefined || book.sortKey < until)).length

  it('drifts, and is caught drifting, when a boundary is written around them', async () => {
    /*
     * The defect itself, reproduced. This is the statement the repository makes,
     * made without it, and it is what every boundary write in this repository did
     * between #170 and #213: `separators` gains a row, `area` gains nothing, and
     * a plank's worth of books is drawn on the plank before.
     */
    const { pool } = await backfilled()
    expect(await disagreements(pool)).toEqual([])

    await pool.query(
      `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
       VALUES ('fiction', 'area', 'key-0030', 20, '', '2026-08-09T00:00:00.000Z')`,
    )

    const found = await disagreements(pool)
    // Everything from the new boundary to the next bookcase break is one area
    // further along than the areas say. The books past `key-0088` are on a new
    // bookcase either way, so the shift stops there.
    expect(found[0]).toBe('Book 031: separators say 1C, rules say 1B')
    expect(found).toHaveLength(fictionFrom('key-0030', 'key-0088'))
  })

  it('gains an area when a plank boundary is added', async () => {
    const { pool, boundaries } = await backfilled()
    const before = await counted(pool, 'area')

    await boundaries.add(added('fiction', 'area', 'key-0030', 20))

    expect(await counted(pool, 'area')).toBe(before + 1)
    expect(await disagreements(pool)).toEqual([])
  })

  it('gains a bookcase when a bookcase boundary is added', async () => {
    const { pool, boundaries } = await backfilled()
    const fixtures = await counted(pool, 'fixture')

    // Non-fiction, because it is the range with room: it is the last one on the
    // floor, so a bookcase after its own is a bookcase nothing else numbers.
    await boundaries.add(added('nonfiction', 'shelf', 'key-0180', 20))

    expect(await counted(pool, 'fixture')).toBe(fixtures + 1)
    expect(await disagreements(pool)).toEqual([])
  })

  it('will not number a bookcase another range already has, and says what that costs', async () => {
    /*
     * Fiction fills bookcases 1 to 3 and non-fiction starts on 4, so a fourth
     * bookcase in fiction is two runs sharing a number. `0013` refuses that
     * arrangement outright; the write-through cannot, because `separators` is
     * authoritative and a shadow table does not get to veto the shelves.
     *
     * So the area is not written and the disagreement is reported, which is the
     * pre-existing ambiguity becoming visible rather than a new one: that
     * catalogue is already drawing two planks with the label `4A`. Moving
     * non-fiction's starting bookcase in `shelf_ranges` is the way out, and it is
     * what the migration's own refusal says.
     */
    const { pool, boundaries } = await backfilled()
    const fixtures = await counted(pool, 'fixture')

    await boundaries.add(added('fiction', 'shelf', 'key-0230', 20))

    expect(await counted(pool, 'fixture')).toBe(fixtures)
    const found = await disagreements(pool)
    expect(found[0]).toBe('Book 230: separators say 4A, rules say 3B')
    expect(found).toHaveLength(fictionFrom('key-0230'))
  })

  it('re-anchors the area when a boundary is pointed at a different book', async () => {
    const { pool, boundaries } = await backfilled()

    await boundaries.reanchor(await boundaryAt(pool, 'key-0022'), 'key-0020')

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM area WHERE starts_at = 'key-0020'",
    )
    expect(rows[0]!.n).toBe('1')
    expect(await disagreements(pool)).toEqual([])
  })

  it('keeps the two in step when two boundaries on one anchor swap places', async () => {
    /*
     * `position` decides exactly one thing, and this is it: which of two
     * boundaries sharing an anchor is stepped over first. A bookcase break and a
     * plank break on one key are two different arrangements depending on their
     * order, so renumbering them moves an area from one bookcase to the next.
     * Non-fiction, because it is the range with room for another bookcase.
     */
    const { pool, boundaries } = await backfilled()
    await boundaries.add(added('nonfiction', 'shelf', 'key-0150', 11))
    expect(await shape(pool)).toEqual({ 1: 3, 2: 4, 3: 2, 4: 3, 5: 2 })
    expect(await disagreements(pool)).toEqual([])

    // The bookcase break stepped over first, so the plank break opens a plank on
    // the new bookcase rather than the last one of the old.
    await boundaries.reposition(await boundaryAt(pool, 'key-0150', 'area'), 12)

    expect(await shape(pool)).toEqual({ 1: 3, 2: 4, 3: 2, 4: 2, 5: 3 })
    expect(await disagreements(pool)).toEqual([])
  })

  it('loses the last area of the run when a boundary is removed', async () => {
    const { pool, boundaries } = await backfilled()
    const before = await counted(pool, 'area')

    await boundaries.remove(await boundaryAt(pool, 'key-0055'))

    expect(await counted(pool, 'area')).toBe(before - 1)
    expect(await disagreements(pool)).toEqual([])
  })

  it('keeps an area a book was placed in, rather than orphaning the placement', async () => {
    /*
     * The interesting case, and the one the schema has already decided. Removing
     * a boundary makes the run one area shorter, so the **last** area of the
     * range is the one with nothing left to describe. `book_placement.area_id` is
     * `ON DELETE RESTRICT` on purpose: a placement is a record of where a book
     * actually was, and furniture taken out later must not quietly rewrite it.
     *
     * So the area stays, the two models then disagree about the books on it, and
     * the check says which books by name. Nothing is orphaned, nothing is
     * silent, and nobody's history is edited to make a shadow table tidy.
     */
    const { pool, boundaries } = await backfilled()

    const tail = await pool.query<{ id: number }>(
      "SELECT id FROM area WHERE starts_at = 'key-0205'",
    )
    const areaId = tail.rows[0]!.id
    const book = await pool.query<{ id: number }>(
      "SELECT id FROM books WHERE title = 'Book 205'",
    )
    const bookId = book.rows[0]!.id

    await pool.query(
      `INSERT INTO book_placement (book_id, kind, area_id, sort_key, actor, reason, created_at)
       VALUES ($1, 'placed', $2, 'key-0205', 'person', 'recorded at 3B',
               '2026-08-09T00:00:00.000Z')`,
      [bookId, areaId],
    )
    await pool.query('UPDATE books SET current_area_id = $1 WHERE id = $2', [areaId, bookId])

    await boundaries.remove(await boundaryAt(pool, 'key-0205'))

    const kept = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM area WHERE id = $1',
      [areaId],
    )
    expect(kept.rows[0]!.n).toBe('1')

    const found = await disagreements(pool)
    expect(found[0]).toBe('Book 205: separators say 3A, rules say 3B')
    expect(found).toHaveLength(fictionFrom('key-0205'))
  })
})

/**
 * The same question, asked after the journeys a person actually makes.
 *
 * `Shelves` is not touched by #213 and that is the point being asserted: the
 * overflow cascade, the boundary move and Remove all reach the four statements
 * in `DrizzleSeparatorRepository`, so they are covered without knowing they are,
 * exactly as #214's two command line tools were.
 */
describe('the areas following the separators after a person moves a book', () => {
  async function backfilled(): Promise<{ pool: pg.Pool; shelves: Shelves }> {
    const pool = await catalogueOf(LIVE_SIZED, LIVE_SEPARATORS)
    await migrateToLatest(pool)
    return { pool, shelves: new Shelves(new PgDb(pool)) }
  }

  const areas = async (pool: pg.Pool): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM area')
    return Number(rows[0]!.n)
  }

  const bookNamed = async (pool: pg.Pool, title: string): Promise<number> => {
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM books WHERE title = $1',
      [title],
    )
    return rows[0]!.id
  }

  it('follows the boundary a full plank at the end of the run makes', async () => {
    const { pool, shelves } = await backfilled()
    const before = await areas(pool)

    expect((await shelves.overflow('fiction', '3B', 'area')).ok).toBe(true)

    expect(await areas(pool)).toBe(before + 1)
    expect(await disagreements(pool)).toEqual([])
  })

  it('follows the boundary a full plank in the middle of the run shifts', async () => {
    const { pool, shelves } = await backfilled()
    const before = await areas(pool)

    // 1B exists already, so this re-anchors the boundary that opens it rather
    // than making one.
    expect((await shelves.overflow('fiction', '1A', 'area')).ok).toBe(true)

    expect(await areas(pool)).toBe(before)
    expect(await disagreements(pool)).toEqual([])
  })

  it('follows a book carried across a boundary', async () => {
    const { pool, shelves } = await backfilled()

    // The last fiction book before the boundary at `key-0022`, so it is the one
    // book of 1A that is allowed to cross.
    const moved = await shelves.moveAcrossBoundary(
      'fiction', await bookNamed(pool, 'Book 020'), 'next',
    )
    expect(moved.ok).toBe(true)

    expect(await disagreements(pool)).toEqual([])
  })

  it('follows Remove on a boundary, renumbering and all', async () => {
    const { pool, shelves } = await backfilled()
    const before = await areas(pool)
    const boundary = (await shelves.list('fiction'))[1]!

    await shelves.remove(boundary.id)

    expect(await areas(pool)).toBe(before - 1)
    expect(await disagreements(pool)).toEqual([])
  })
})
