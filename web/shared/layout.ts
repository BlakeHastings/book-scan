/**
 * Turning a sorted run of books into physical locations.
 *
 * The shift from the original design: a book's location is no longer typed in
 * per book, it is derived. You know where a shelf ran out and the software
 * does not, so you mark that point once and everything after it falls onto the
 * next shelf. Insert a book earlier in the alphabet and the boundary does the
 * arithmetic for you.
 *
 * A separator records a CAPACITY, not a bookmark.
 *
 * That distinction is the whole design and it is easy to get wrong. The
 * obvious implementation anchors a separator to the book it was added after,
 * but then inserting anything earlier leaves that shelf holding one more book
 * than it did when you declared it full, which is precisely the thing that
 * cannot happen on a real shelf. Recording "this shelf holds 37" instead means
 * an insert pushes the 38th onto the next shelf, and that displacement
 * cascades exactly as it does in the room.
 */

import type { ShelfRange } from './shelving'

/**
 * Where one shelf, or one whole bookcase, stops.
 *
 * `area` implies `shelf`: running out of bookcase necessarily ends the shelf
 * you were on.
 */
export type SeparatorKind = 'shelf' | 'area'

export interface Separator {
  id: number
  range: ShelfRange
  kind: SeparatorKind
  /**
   * How many books fit on the shelf this separator closes.
   *
   * Captured when the separator is created, by counting what was on that
   * shelf at the time. From then on it is a physical fact about the furniture
   * rather than a fact about any particular book.
   */
  capacity: number
  /** Order among separators; the first closes the first shelf. */
  position: number
}

export interface LayoutInput {
  id: number
  sortKey: string
}

export interface Placed<T extends LayoutInput = LayoutInput> {
  book: T
  /** 0-based. 0 is area A. */
  area: number
  /** 1-based within its area. */
  shelf: number
  label: string
}

/** A, B, ... Z, AA, AB. Enough for any wall of books. */
export function areaLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

export function locationLabel(area: number, shelf: number): string {
  return `${areaLabel(area)}${shelf}`
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
  const ordered = [...separators].sort((a, b) => a.position - b.position)

  let area = 0
  let shelf = 1
  let index = 0
  const placed: Placed<T>[] = []

  const take = (count: number) => {
    for (let taken = 0; taken < count && index < books.length; taken += 1) {
      placed.push({
        book: books[index]!, area, shelf, label: locationLabel(area, shelf),
      })
      index += 1
    }
  }

  for (const separator of ordered) {
    // A zero or negative capacity would stall the walk and hang the caller.
    take(Math.max(0, separator.capacity))
    if (separator.kind === 'area') {
      area += 1
      shelf = 1
    } else {
      shelf += 1
    }
  }

  take(books.length - index)
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
  area: number
  shelf: number
  label: string
  books: Placed<T>[]
  /** Recorded capacity, when this shelf has been marked full. */
  capacity: number | null
  /** The separator closing this shelf, so the UI can offer to remove it. */
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
  const ordered = [...separators].sort((a, b) => a.position - b.position)
  const groups: ShelfGroup<T>[] = []

  for (const item of placed) {
    const last = groups[groups.length - 1]
    if (last && last.label === item.label) {
      last.books.push(item)
    } else {
      groups.push({
        area: item.area, shelf: item.shelf, label: item.label, books: [item],
        capacity: null, separatorId: null, kind: null,
      })
    }
  }

  // The nth shelf is closed by the nth separator, by construction.
  groups.forEach((group, i) => {
    const separator = ordered[i]
    if (!separator) return
    group.capacity = separator.capacity
    group.separatorId = separator.id
    group.kind = separator.kind
  })

  return groups
}

export interface ShelfLoad {
  label: string
  count: number
  capacity: number | null
  /** More books than the shelf was marked to hold. */
  over: boolean
}

/**
 * How full each shelf is.
 *
 * A shelf can read as over capacity only on the final, unclosed run, or when
 * a capacity was lowered after the fact. Surfacing it beats discovering it at
 * the shelf itself.
 */
export function shelfLoads(
  placed: Placed[],
  separators: Separator[] = [],
): ShelfLoad[] {
  return groupByShelf(placed, separators).map((group) => ({
    label: group.label,
    count: group.books.length,
    capacity: group.capacity,
    over: group.capacity !== null && group.books.length > group.capacity,
  }))
}
