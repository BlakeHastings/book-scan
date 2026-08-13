/**
 * Fixtures and areas: the furniture, and the runs of books laid across it.
 *
 * ## An area is not a plank
 *
 * A **fixture** is the thing that groups areas: a bookshelf, a crate, a
 * windowsill. Its `kind` is the owner's word and nothing here branches on it.
 * An **area** is a run of books somebody treats as one place, chosen by a person
 * rather than by the carpentry, so one plank can hold two of them and a plank is
 * deliberately not modelled at all. `docs/shelving.md` has the fuller note.
 *
 * This is `separators` grown a parent. A separator said "a new plank starts
 * here" or "a new bookcase starts here" and the bookcase and the plank existed
 * only as numbers counted while walking that list. An area is the row that was
 * being counted, and `area.starts_at` is `separators.starts_at` under a name
 * that says what it anchors.
 *
 * ## Labels are derived here and stored nowhere
 *
 * A stored label goes stale the moment somebody renames a fixture, so there is
 * no label column and `labelFor` is the only place a label comes from.
 *
 * ## What a run is, and why it stops where it does
 *
 * Every area in a collection lies in one sequence: fixture position, then area
 * position within it. A **run** is a stretch of that sequence ordered one way
 * and filled from one end, and it breaks in exactly two places:
 *
 * - where a placement rule points, because that is a different set of books
 *   arriving from a different rule;
 * - at an area with a strategy of its own, because such an area is
 *   self-contained and takes no overflow. A continuous run only works if every
 *   area in it orders the same way, so an area that orders differently is the
 *   start of its own run rather than the middle of somebody else's.
 *
 * That is the same shape the app has today, said in rows: `shelf_range` picks a
 * run, `start_shelf` and `start_area` say where it begins, and the separators
 * cut it up.
 */

import { areaLabel as letterFor } from '../../shared/layout'
import { INHERIT, type SortStrategy } from './strategies'

/** The one row that holds what is true of the whole collection. */
export interface Collection {
  id: number
  name: string
  /** Never `inherit`: there is nothing above a collection to ask. */
  defaultSortStrategy: Exclude<SortStrategy, typeof INHERIT>
}

export interface Fixture {
  id: number
  /** Its ordinal among the fixtures, 1-based, which is the `1` in `1A`. */
  position: number
  /** The owner's word for what it is. Nothing branches on it. */
  kind: string
  /** Empty when nobody has named it, which is when the position is the label. */
  name: string
  sortStrategy: SortStrategy
}

export interface Area {
  id: number
  fixtureId: number
  /** Its ordinal within its fixture, 0-based, which is the `A` in `1A`. */
  position: number
  name: string
  /**
   * The sort key the first book in this area has, byte-ordered and compared
   * against `books.sort_key`.
   *
   * Anchored to a position in the order rather than to a book id, so removing
   * the book it names leaves the area describing the right *place*. Empty on the
   * first area of a run, which is how "everything from the beginning" is said
   * without a null.
   */
  startsAt: string
  sortStrategy: SortStrategy
}

/** One area, with the fixture it hangs on, which is what a label needs. */
export interface Slot {
  fixture: Fixture
  area: Area
}

const NAME_JOIN = ' · '

/**
 * What a fixture on its own reads as: its name, or its number.
 *
 * The left half of `labelFor`, named because a screen listing the furniture asks
 * for the piece rather than for a plank on it, and two spellings of "the name,
 * or the number" is how one of them ends up saying `Bookcase 4` and the other
 * `4`.
 */
export function fixtureLabel(fixture: Fixture): string {
  return fixture.name || String(fixture.position)
}

/**
 * What a person reads, built from the positions and the two names.
 *
 * | fixture name | area name | label |
 * | --- | --- | --- |
 * | `''` | `''` | `1A` |
 * | `Hall shelf` | `''` | `Hall shelf · A` |
 * | `Hall shelf` | `Cookery` | `Hall shelf · Cookery` |
 * | `''` | `Cookery` | `1 · Cookery` |
 *
 * The unnamed case runs the two parts together because `1A` is the label this
 * catalogue has always used and is what is written on the recorded locations of
 * every book in it. Naming either side makes the label a phrase, which needs a
 * separator to read as one.
 */
export function labelFor(slot: Slot): string {
  const left = fixtureLabel(slot.fixture)
  const right = slot.area.name || letterFor(slot.area.position)
  const named = Boolean(slot.fixture.name || slot.area.name)
  return named ? `${left}${NAME_JOIN}${right}` : `${left}${right}`
}

/**
 * Every area in the collection, in the order a book meets them.
 *
 * Fixture position first, then fixture id, then area position. The id in the
 * middle is not decoration: `shelf_ranges.start_shelf` puts non-fiction on
 * bookcase 4 today, so two fixtures can carry the same position, and without a
 * total order the areas of two runs would interleave differently between reads.
 * Ordering by id keeps each run's fixtures together in the order they were
 * created, which is the order they were walked in. The backfill refuses an
 * arrangement where that is not enough; see `0013`.
 *
 * An area whose fixture is not in `fixtures` is dropped rather than guessed at;
 * the foreign key means that cannot happen against a database, and this function
 * is also handed rows a test built.
 */
export function slotsInOrder(fixtures: Fixture[], areas: Area[]): Slot[] {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  return areas
    .flatMap((area) => {
      const fixture = byId.get(area.fixtureId)
      return fixture ? [{ fixture, area }] : []
    })
    .sort((a, b) =>
      a.fixture.position - b.fixture.position
      || a.fixture.id - b.fixture.id
      || a.area.position - b.area.position)
}

/**
 * Where each run begins: the areas nothing flows into.
 *
 * A slot starts a run when something points at it, or when its area orders
 * itself. `entries` holds the area ids the placement rules name, worked out by
 * `rules.ts`, which is the only thing that knows what a rule points at.
 */
function startsARun(slot: Slot, entries: ReadonlySet<number>): boolean {
  return entries.has(slot.area.id) || slot.area.sortStrategy !== INHERIT
}

/**
 * The run a given area opens, up to but not including the next run's first
 * area.
 *
 * Returns an empty list when the area named does not open a run, which is a
 * caller asking about the middle of somebody else's run and is worth an empty
 * answer rather than a plausible one.
 */
export function runFrom(
  order: Slot[],
  areaId: number,
  entries: ReadonlySet<number>,
): Slot[] {
  const from = order.findIndex((slot) => slot.area.id === areaId)
  if (from === -1 || !startsARun(order[from]!, entries)) return []

  const run = [order[from]!]
  for (const slot of order.slice(from + 1)) {
    if (startsARun(slot, entries)) break
    run.push(slot)
  }
  return run
}

/**
 * Which area of a run a sort key lands in.
 *
 * The last area whose anchor the key has reached, which is the same walk
 * `layoutRange` makes over separators and is why the two agree book for book. A
 * key below every anchor lands in the run's first area, because a book that
 * sorts before the first boundary is on the first plank: the boundaries say
 * where the run is cut, not where it starts.
 *
 * `<=` rather than `<` is what makes the anchor the **first** book of its area
 * rather than the last of the one before, and it keeps an anchor meaningful once
 * the book it names has been deleted.
 */
export function areaFor(run: Slot[], sortKey: string): Slot | null {
  let landed: Slot | null = null
  for (const slot of run) {
    if (landed && slot.area.startsAt > sortKey) break
    landed = slot
  }
  return landed
}
