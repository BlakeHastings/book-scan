/**
 * Turning a sorted run of books into physical locations.
 *
 * A boundary says WHERE a shelf starts, and nothing about how much it holds.
 *
 * An earlier version stored a capacity instead: "this shelf holds 37". That
 * is wrong, and wrong in a way that only shows up with real books. A count is
 * not a fact about the furniture, it is a fact about the particular mix of
 * spines that happened to be there. Swap one paperback for a hardback and the
 * same shelf holds 36. Any number the software predicts will drift out of
 * step with the wood.
 *
 * So it predicts nothing. Inserting a book simply grows the shelf it lands
 * on, which may be perfectly fine. The only reliable signal that a shelf is
 * full is a person standing in front of it saying so, and when they do,
 * `overflow` moves the boundary and reports the one book that has to shift.
 * If that shelf will not take it either, they say so again and it walks on.
 */

import type { ShelfRange } from './shelving'

/**
 * Which boundary this is.
 *
 * Vocabulary, because getting it backwards caused real confusion: a SHELF is
 * a whole bookcase, numbered 1, 2, 3. An AREA is one physical plank inside it,
 * lettered A, B, C. So 1A is the top plank of the first bookcase, and running
 * out of shelf necessarily ends the area you were on.
 */
export type SeparatorKind = 'shelf' | 'area'

export interface Separator {
  id: number
  range: ShelfRange
  /** Whether this boundary starts a new shelf or a whole new bookcase. */
  kind: SeparatorKind
  /**
   * Sort key of the first book on the new shelf.
   *
   * Anchored to a position in the order rather than to a row id, so that
   * removing the book it points at leaves the boundary describing the right
   * *place* instead of orphaning it.
   */
  startsAt: string
  /** Order among boundaries within a range. */
  position: number
}

export interface LayoutInput {
  id: number
  sortKey: string
}

export interface Placed<T extends LayoutInput = LayoutInput> {
  book: T
  /** Bookcase, 1-based. */
  shelf: number
  /** Plank within that bookcase, 0-based. 0 is area A. */
  area: number
  /** Reads shelf then area: 1A, 1B, 2A. */
  label: string
}

/** A, B, ... Z, AA. The planks within one bookcase. */
export function areaLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

/** Shelf first, then area: 1A is the top plank of bookcase 1. */
export function locationLabel(shelf: number, area: number): string {
  return `${shelf}${areaLabel(area)}`
}

/**
 * Assign every book a shelf by filling each one to its recorded capacity.
 *
 * `books` must already be in sort order; that ordering is the shelf order.
 * Books past the last separator land on a final, open-ended shelf, which is
 * where everything sits before any capacity has been marked at all.
 */
export function layoutRange<T extends LayoutInput>(
  books: T[],
  separators: Separator[],
): Placed<T>[] {
  const ordered = [...separators]
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))

  let shelf = 1
  let area = 0
  let next = 0
  const placed: Placed<T>[] = []

  for (const book of books) {
    // Step over every boundary this book has reached. Comparing with <= is
    // what makes the anchor the FIRST book of the new shelf rather than the
    // last of the old one, and it keeps a boundary meaningful when the book
    // it named has since been deleted.
    while (next < ordered.length && ordered[next]!.startsAt <= book.sortKey) {
      if (ordered[next]!.kind === 'shelf') {
        // A whole bookcase ended, so we are back at its top plank.
        shelf += 1
        area = 0
      } else {
        area += 1
      }
      next += 1
    }

    placed.push({ book, shelf, area, label: locationLabel(shelf, area) })
  }

  return placed
}

export interface Move {
  id: number
  from: string
  to: string
}

/**
 * Which books ended up somewhere new.
 *
 * This is the point of deriving locations. Adding one book near the start of
 * the alphabet pushes the last book off that shelf and onto the next, which
 * pushes that shelf's last book along in turn. Every one of those is a
 * physical job somebody has to do, and reporting them is the difference
 * between a catalogue that matches the shelves and one that drifts out of
 * step with them.
 */
export function diffLayout(before: Placed[], after: Placed[]): Move[] {
  const was = new Map(before.map((p) => [p.book.id, p.label]))
  const moves: Move[] = []

  for (const placed of after) {
    const from = was.get(placed.book.id)
    if (from !== undefined && from !== placed.label) {
      moves.push({ id: placed.book.id, from, to: placed.label })
    }
  }

  return moves
}

export interface ShelfGroup<T extends LayoutInput = LayoutInput> {
  /** Bookcase, 1-based. */
  shelf: number
  /** Plank within it, 0-based. */
  area: number
  label: string
  books: Placed<T>[]
  /** The boundary that starts this shelf, if it is not the first. */
  separatorId: number | null
  kind: SeparatorKind | null
}

/**
 * Group a layout for display, one entry per physical shelf, carrying the
 * separator that closes it.
 */
export function groupByShelf<T extends LayoutInput>(
  placed: Placed<T>[],
  separators: Separator[] = [],
): ShelfGroup<T>[] {
  const byStart = new Map(separators.map((s) => [s.startsAt, s]))
  const groups: ShelfGroup<T>[] = []

  for (const item of placed) {
    const last = groups[groups.length - 1]
    if (last && last.label === item.label) {
      last.books.push(item)
      continue
    }
    const opener = byStart.get(item.book.sortKey)
    groups.push({
      shelf: item.shelf, area: item.area, label: item.label, books: [item],
      separatorId: opener?.id ?? null, kind: opener?.kind ?? null,
    })
  }

  return groups
}

export interface ShelfLoad {
  label: string
  count: number
}

/** How many books are on each shelf right now. No prediction, just a count. */
export function shelfLoads(
  placed: Placed[],
  separators: Separator[] = [],
): ShelfLoad[] {
  return groupByShelf(placed, separators).map((group) => ({
    label: group.label,
    count: group.books.length,
  }))
}

export interface Overflow {
  /** The book that has to come off this shelf. */
  moved: LayoutInput
  from: string
  to: string
  /** Boundary to create, when the shelf it moves onto does not exist yet. */
  create?: { startsAt: string; kind: SeparatorKind }
  /** Boundary to move earlier, when the next shelf already exists. */
  shift?: { id: number; startsAt: string }
}

/**
 * Make room on a shelf the person says is full.
 *
 * The last book on it has to come off and go to the front of the next shelf,
 * which means that shelf's boundary moves one book earlier. If there is no
 * next shelf, one is created.
 *
 * Deliberately one step at a time. Whether the next shelf can take the extra
 * book is not something that can be computed, so the caller asks the person
 * and calls again if the answer is no. That walk is the guided sequence.
 */
export function overflow(
  placed: Placed[],
  separators: Separator[],
  label: string,
  kindIfNew: SeparatorKind = 'area',
): Overflow | null {
  const groups = groupByShelf(placed, separators)
  const index = groups.findIndex((g) => g.label === label)
  if (index === -1) return null

  const group = groups[index]!
  // A shelf holding one book cannot give anything up without emptying itself.
  if (group.books.length < 2) return null

  const moved = group.books[group.books.length - 1]!.book
  const nextGroup = groups[index + 1]

  if (!nextGroup) {
    return {
      moved,
      from: label,
      to: locationLabel(
        kindIfNew === 'shelf' ? group.shelf + 1 : group.shelf,
        kindIfNew === 'shelf' ? 0 : group.area + 1,
      ),
      create: { startsAt: moved.sortKey, kind: kindIfNew },
    }
  }

  return {
    moved,
    from: label,
    to: nextGroup.label,
    // The next shelf now starts one book earlier.
    shift: nextGroup.separatorId !== null
      ? { id: nextGroup.separatorId, startsAt: moved.sortKey }
      : undefined,
  }
}
