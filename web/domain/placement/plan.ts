/**
 * What the rules want, said as a list of books to carry, before anything is
 * written.
 *
 * **Plan and apply are the same answer read twice.** `AssignPlacementsHandler`
 * runs the rules and writes an `assigned` row wherever the answer differs from
 * where the book already is; this runs the same rules over the same rows and
 * writes nothing, so what a person approves is what gets recorded. There is no
 * plan table and there must not be one: a plan that had to be stored would be a
 * third opinion about where a book goes, beside `assigned` and `placed`, and the
 * reason the ledger has two kinds is that two is the number.
 *
 * ## The comparison is on labels, and that is deliberate
 *
 * The handler compares area ids, because it is writing rows that name areas.
 * This compares the labels a person reads, because it is answering "which plank
 * do I take this off and which do I put it on". The two agree wherever a label
 * identifies a plank, which is everywhere on a bookcase's face; where they can
 * differ is a plank that has been taken out and put back, and there the label is
 * the honest answer, because the person is standing in front of the shelf.
 *
 * ## What it refuses to leave out
 *
 * A plan that says "50 books move" having quietly dropped three pinned ones is
 * lying by omission, so every book the rules will not touch is counted here with
 * the reason it was left alone:
 *
 * - **pinned**, because a pin is a person overruling the rules and it beats them
 *   forever;
 * - **checked out** and **withdrawn**, because neither is on a shelf to be
 *   carried off one;
 * - **unclaimed**, where no rule matches the book at all, which is how the
 *   person who wrote the rules finds out;
 * - **never placed**, where nobody has ever said where the book is, so there is
 *   no plank to take it off. The rules will still assign it; it is just not a
 *   book anybody carries anywhere.
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

/**
 * Every book coming off one plank and going onto one other.
 *
 * The unit a person acts on. 187 moves is not a list on a phone; "22 books,
 * 4C to 3C" is, and the books are underneath it for when a number looks wrong.
 */
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
 * Run the rules over a catalogue and answer what would have to happen.
 *
 * `order` is the furniture as it would stand, which is the whole of how a
 * proposed change is planned: hand it the prospective arrangement from
 * `relocateRun` and this answers the proposal, hand it the arrangement that
 * exists and this answers the present.
 *
 * `placed` names where the books are **now**, one label per area, and is a
 * separate argument for two reasons. A proposal's furniture no longer holds the
 * planks the books are standing on; and a book can be recorded on a plank that
 * has been taken out, which is off every arrangement there is and still reads as
 * the plank somebody wrote down.
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

    const from = placed.get(standing.area) ?? ''
    const to = there.get(found.slot.area.id) ?? ''
    if (from === to) { staying += 1; continue }

    const key = `${from}${to}`
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
