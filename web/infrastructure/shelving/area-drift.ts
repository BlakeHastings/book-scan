/**
 * The check that lets `area` exist beside `separators`.
 *
 * **This is #184's book-by-book comparison, made continuous.** That comparison
 * placed every one of 236 books twice, once by the code the app runs today and
 * once by the rows `0013` wrote, and proved the two answers identical. It proved
 * it *at the moment of the backfill*, and #213 is what that proof expires to:
 * the first boundary somebody moves, the claim is about a catalogue that no
 * longer exists.
 *
 * So the comparison moves out of the migration's test and into code that can be
 * run against any catalogue at any time. `applySchema` runs it on every start,
 * `placement-backfill.test.ts` runs it after the backfill and again after a
 * divider is added, moved and removed, and it is what the write-through in
 * `areas.ts` is measured by rather than described by.
 *
 * ## Two models, neither of them this file's own
 *
 * Nothing here re-implements a placement. `underSeparators` is `layoutRange`,
 * which is what `Shelves.layout` calls; `underRules` is `placementOf` over
 * `slotsInOrder`, which is the whole of the new model. A check that walked the
 * boundaries itself would agree with whichever of the two it was written from
 * and say nothing about the other.
 *
 * It is deliberately not the derivation `areas.ts` writes with, either. A writer
 * checked by its own arithmetic proves that it is self-consistent, which is the
 * one thing that was never in doubt.
 *
 * ## Reported, not repaired
 *
 * Nothing here writes. `recordAreasOf` is the repair, and running it is a
 * decision somebody makes having read the report, in the same way
 * `rebuildProjection` is for `books.current_area_id` (#185). Repairing on sight
 * would destroy the evidence of which writer is missing, which is the only
 * question a disagreement actually asks.
 */

import { labelFor, slotsInOrder, type Area, type Fixture, type Slot } from '../../domain/placement/geography'
import { placementOf, type PlacementRule, type RuleOperator } from '../../domain/placement/rules'
import type { SortStrategy } from '../../domain/placement/strategies'
import type { Db } from '../../server/driver'
import { layoutRange, type Separator, type SeparatorKind } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

/** One book the two models put in different places. */
export interface AreaDisagreement {
  bookId: number
  title: string
  /** The plank the separators put it on, which is where the app puts it today. */
  fromSeparators: string
  /** The plank the areas and the rules put it on, or '' when nothing claims it. */
  fromRules: string
}

/** The disagreement said the way a reviewer reads it, in one line. */
export function describeAreaDisagreement(one: AreaDisagreement): string {
  return `${one.title}: separators say ${one.fromSeparators}, ` +
    `rules say ${one.fromRules || 'nowhere'}`
}

interface BookRow {
  id: number
  title: string
  sort_key: string
}

/**
 * Where the app puts every shelved book today, range by range.
 *
 * The three reads are `Shelves.startOf`, `Shelves.booksIn` and
 * `DrizzleSeparatorRepository.inRange` spelled out, in that order and with those
 * orderings, because the order the boundaries come back in is what decides where
 * two sharing an anchor are stepped over.
 */
async function underSeparators(db: Db): Promise<Map<number, { title: string; label: string }>> {
  const placed = new Map<number, { title: string; label: string }>()

  const ranges = await db.all<{ shelf_range: ShelfRange; start_shelf: number; start_area: number }>(
    'SELECT shelf_range, start_shelf, start_area FROM shelf_ranges ORDER BY shelf_range',
  )

  for (const range of ranges) {
    const books = await db.all<BookRow>(
      'SELECT id, title, sort_key FROM shelved_books WHERE shelf_range = ? ORDER BY sort_key ASC',
      [range.shelf_range],
    )
    const separators = await db.all<{
      id: number; kind: SeparatorKind; starts_at: string; position: number
    }>(
      'SELECT id, kind, starts_at, position FROM separators WHERE shelf_range = ? ORDER BY position',
      [range.shelf_range],
    )

    const layout = layoutRange(
      books.map((row) => ({ id: row.id, title: row.title, sortKey: row.sort_key })),
      separators.map((row): Separator => ({
        id: row.id,
        range: range.shelf_range,
        kind: row.kind,
        startsAt: row.starts_at,
        position: row.position,
      })),
      { shelf: range.start_shelf, area: range.start_area },
    )

    for (const one of layout) {
      placed.set(one.book.id, { title: one.book.title, label: one.label })
    }
  }

  return placed
}

/** The furniture and the rules, read back out of the rows. */
async function furnitureIn(db: Db): Promise<{ order: Slot[]; rules: PlacementRule[] }> {
  const fixtures = await db.all<{
    id: number; position: number; kind: string; name: string; sort_strategy: SortStrategy
  }>('SELECT id, position, kind, name, sort_strategy FROM fixture')

  const areas = await db.all<{
    id: number; fixture_id: number; position: number; name: string;
    starts_at: string; sort_strategy: SortStrategy
  }>('SELECT id, fixture_id, position, name, starts_at, sort_strategy FROM area')

  const rules = await db.all<{
    id: number; area_id: number | null; fixture_id: number | null;
    priority: number; name: string; enabled: boolean
  }>('SELECT id, area_id, fixture_id, priority, name, enabled FROM placement_rule')

  const conditions = await db.all<{
    rule_id: number; field: 'tag'; operator: RuleOperator; value: string
  }>('SELECT rule_id, field, operator, value FROM rule_condition ORDER BY id')

  const order = slotsInOrder(
    fixtures.map((row): Fixture => ({
      id: row.id, position: row.position, kind: row.kind, name: row.name,
      sortStrategy: row.sort_strategy,
    })),
    areas.map((row): Area => ({
      id: row.id, fixtureId: row.fixture_id, position: row.position, name: row.name,
      startsAt: row.starts_at, sortStrategy: row.sort_strategy,
    })),
  )

  return {
    order,
    rules: rules.map((row): PlacementRule => ({
      id: row.id,
      areaId: row.area_id,
      fixtureId: row.fixture_id,
      priority: row.priority,
      name: row.name,
      enabled: row.enabled,
      conditions: conditions
        .filter((condition) => condition.rule_id === row.id)
        .map(({ field, operator, value }) => ({ field, operator, value })),
    })),
  }
}

/** Where the rules and the areas put every shelved book, run through the domain. */
async function underRules(db: Db): Promise<Map<number, string>> {
  const { order, rules } = await furnitureIn(db)

  const books = await db.all<BookRow & { slugs: string[] }>(
    `SELECT b.id, b.title, b.sort_key,
            array_remove(array_agg(t.slug), NULL) AS slugs
       FROM shelved_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      GROUP BY b.id, b.title, b.sort_key`,
  )

  const placed = new Map<number, string>()
  for (const row of books) {
    const found = placementOf({ sortKey: row.sort_key, tagSlugs: row.slugs ?? [] }, rules, order)
    // Empty rather than thrown, so a book the rules cannot place shows up as a
    // disagreement instead of stopping the check.
    placed.set(row.id, found ? labelFor(found.slot) : '')
  }
  return placed
}

/**
 * Every shelved book the separators and the areas put in different places.
 *
 * Ordered by id, which is the order the two backfill tests already read, and
 * unbounded: the caller decides how many to say out loud, because the total is
 * the number that matters and the names are the ones that explain it.
 */
export async function areaDisagreements(db: Db): Promise<AreaDisagreement[]> {
  const [separators, rules] = await Promise.all([underSeparators(db), underRules(db)])

  const found: AreaDisagreement[] = []
  for (const [bookId, { title, label }] of separators) {
    const fromRules = rules.get(bookId) ?? ''
    if (fromRules !== label) {
      found.push({ bookId, title, fromSeparators: label, fromRules })
    }
  }

  return found.sort((a, b) => a.bookId - b.bookId)
}
