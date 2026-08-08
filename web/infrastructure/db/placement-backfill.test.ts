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
import { SCHEMA } from '../../server/db.pg'
import { layoutRange, type Separator, type SeparatorKind } from '../../shared/layout'
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

  for (const book of books) {
    await pool.query(
      `INSERT INTO books (title, shelf_range, is_fiction, sort_key, scanned_at,
                          classification_source, classification_confidence)
       VALUES ($1, $2, $3, $4, '2026-01-02T03:04:05.000Z', 'auto', 'high')`,
      [book.title, book.range, book.range === 'fiction' ? 1 : 0, book.sortKey],
    )
  }

  for (const [at, separator] of separators.entries()) {
    await pool.query(
      `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
       VALUES ($1, $2, $3, $4, '', '2026-01-02T03:04:05.000Z')`,
      [separator.range, separator.kind, separator.startsAt, at],
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

/** Where the app puts every book today: `Shelves.layout`, range by range. */
async function underSeparators(pool: pg.Pool): Promise<Placement[]> {
  const placed: Placement[] = []

  const ranges = await pool.query<{ shelf_range: Range; start_shelf: number; start_area: number }>(
    'SELECT shelf_range, start_shelf, start_area FROM shelf_ranges ORDER BY shelf_range',
  )

  for (const range of ranges.rows) {
    const books = await pool.query<{ id: number; title: string; sort_key: string }>(
      'SELECT id, title, sort_key FROM shelved_books WHERE shelf_range = $1 ORDER BY sort_key ASC',
      [range.shelf_range],
    )
    // Ordered by position, which is how `DrizzleSeparatorRepository.inRange`
    // reads them and therefore the order `layoutRange`'s stable sort keeps for
    // two boundaries sharing an anchor.
    const separators = await pool.query<{
      id: number; kind: SeparatorKind; starts_at: string; position: number
    }>(
      'SELECT id, kind, starts_at, position FROM separators WHERE shelf_range = $1 ORDER BY position',
      [range.shelf_range],
    )

    const layout = layoutRange(
      books.rows.map((row) => ({ id: row.id, title: row.title, sortKey: row.sort_key })),
      separators.rows.map((row): Separator => ({
        id: row.id,
        range: range.shelf_range,
        kind: row.kind,
        startsAt: row.starts_at,
        position: row.position,
      })),
      { shelf: range.start_shelf, area: range.start_area },
    )

    for (const one of layout) {
      placed.push({ id: one.book.id, title: one.book.title, label: one.label })
    }
  }

  return placed.sort((a, b) => a.id - b.id)
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

/** The books the two models disagree about, said the way a reviewer reads it. */
function disagreements(old: Placement[], now: Placement[]): string[] {
  const byId = new Map(now.map((one) => [one.id, one]))
  return old.flatMap((one) => {
    const other = byId.get(one.id)
    return other && other.label === one.label
      ? []
      : [`${one.title}: separators say ${one.label}, rules say ${other?.label || 'nowhere'}`]
  })
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

    const old = await underSeparators(pool)
    const now = await underRules(pool)

    expect(old).toHaveLength(LIVE_SIZED.length)
    expect(disagreements(old, now)).toEqual([])

    // Printed rather than only asserted, because these are the two strings the
    // pull request quotes. Nothing in `0013` writes to `books`, so they are the
    // same string, read through the view afterwards and through the condition
    // that view replaced before.
    const after = await shelfOrder(pool, 'shelved_books')
    console.log(`[placement] shelf order ${before} before, ${after} after; ` +
      `${old.length} books compared across ${new Set(old.map((one) => one.label)).size} areas`)
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
    expect(disagreements(await underSeparators(pool), await underRules(pool))).toEqual([])

    await pool.query("UPDATE area SET starts_at = 'key-0020' WHERE starts_at = 'key-0022'")

    expect(disagreements(await underSeparators(pool), await underRules(pool)))
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
    expect(disagreements(await underSeparators(pool), await underRules(pool))).toEqual([])

    await pool.query("UPDATE placement_rule SET priority = 3 WHERE name = 'Fiction'")

    expect(disagreements(await underSeparators(pool), await underRules(pool))).toEqual([
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

    const found = disagreements(await underSeparators(pool), await underRules(pool))
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
