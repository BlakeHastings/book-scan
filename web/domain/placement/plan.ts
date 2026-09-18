/**
 * What the rules want, as a list of books to carry, before anything is written.
 * No separate plan table: `AssignPlacementsHandler` and this run the same
 * rules over the same rows, one writing and one not.
 *
 * Whether a book moves is decided on `standing.area` against
 * `found.slot.area.id`, never on the rendered labels: two pieces of furniture
 * can stand on the same number, so two different planks can render the same
 * label (see `slotsInOrder`).
 *
 * Every book the rules will not touch is counted with a reason, so a plan
 * never silently drops one: pinned, checked-out, withdrawn (not on a shelf to
 * carry off), unclaimed (no rule matches), or never-placed (nowhere to take
 * it off, though the rules will still assign it).
 */

import { labelFor, type Slot } from './geography'
import { standingOf, type Placement } from './ledger'
import { placementOf, type PlacementRule } from './rules'

/** What planning needs to know about a book, which is what a shelf row shows. */
export interface PlannableBook {
  id: number
  title: string
  authorFiling: string
  sortKey: string
  tagSlugs: readonly string[]
}

/** A book as the plan names it: enough to recognise it holding the shelf. */
export interface PlannedBook {
  id: number
  title: string
  authorFiling: string
}

/** The unit a person acts on: books grouped by their one shared move. */
export interface PlanGroup {
  from: string
  to: string
  books: PlannedBook[]
}

export const SKIP_REASONS = ['pinned', 'checked-out', 'withdrawn', 'never-placed'] as const

export type SkipReason = (typeof SKIP_REASONS)[number]

export interface SkippedBooks {
  reason: SkipReason
  books: PlannedBook[]
}

export interface PlacementPlan {
  /** The books to carry, grouped by the two planks each move names. */
  groups: PlanGroup[]
  /** How many books are in those groups, which is the headline number. */
  moving: number
  /** Books the rules leave exactly where they are. */
  staying: number
  /** Everything the rules will not move, and why. Never silently empty. */
  skipped: SkippedBooks[]
  /** Books no rule claims. The rules have nowhere to put them. */
  unclaimed: PlannedBook[]
}

const named = (book: PlannableBook): PlannedBook => ({
  id: book.id,
  title: book.title,
  authorFiling: book.authorFiling,
})

function rowsByBook(rows: readonly Placement[]): Map<number, Placement[]> {
  const grouped = new Map<number, Placement[]>()
  for (const row of rows) {
    const existing = grouped.get(row.bookId)
    if (existing) existing.push(row)
    else grouped.set(row.bookId, [row])
  }
  return grouped
}

/**
 * Runs the rules over a catalogue and answers what would have to happen.
 *
 * `order` is the furniture as it would stand: hand it the prospective
 * arrangement from `relocateRun` to preview a change, or the current one to
 * see the present.
 *
 * `placed` names where books are now, one label per area, kept separate
 * because a book can be recorded on a plank that has since been removed and
 * so no longer appears in `order`.
 */
export function planPlacements(
  books: readonly PlannableBook[],
  rows: readonly Placement[],
  rules: PlacementRule[],
  order: Slot[],
  placed: ReadonlyMap<number, string>,
): PlacementPlan {
  const history = rowsByBook(rows)
  const there = new Map(order.map((slot) => [slot.area.id, labelFor(slot)]))

  const grouped = new Map<string, PlanGroup>()
  const skipped = new Map<SkipReason, PlannedBook[]>()
  const unclaimed: PlannedBook[] = []
  let moving = 0
  let staying = 0

  const skip = (reason: SkipReason, book: PlannableBook) => {
    const books = skipped.get(reason) ?? []
    books.push(named(book))
    skipped.set(reason, books)
  }

  for (const book of books) {
    const standing = standingOf(history.get(book.id) ?? [])
    if (standing.pinned) { skip('pinned', book); continue }
    if (standing.checkedOut) { skip('checked-out', book); continue }
    if (standing.withdrawn) { skip('withdrawn', book); continue }

    const found = placementOf(book, rules, order)
    if (!found) { unclaimed.push(named(book)); continue }

    if (standing.area === null) { skip('never-placed', book); continue }

    if (standing.area === found.slot.area.id) { staying += 1; continue }

    const from = placed.get(standing.area) ?? ''
    const to = there.get(found.slot.area.id) ?? ''
    const key = `${standing.area}${found.slot.area.id}`
    const group = grouped.get(key) ?? { from, to, books: [] }
    group.books.push(named(book))
    grouped.set(key, group)
    moving += 1
  }

  return {
    groups: [...grouped.values()].sort((a, b) =>
      a.to.localeCompare(b.to) || a.from.localeCompare(b.from)),
    moving,
    staying,
    skipped: SKIP_REASONS
      .filter((reason) => skipped.has(reason))
      .map((reason) => ({ reason, books: skipped.get(reason)! })),
    unclaimed,
  }
}
