/**
 * Separators, and the derived geography that falls out of them.
 *
 * Keeps all the SQL for shelf boundaries in one place. The arithmetic itself
 * lives in shared/layout.ts and stays pure.
 */

import type { Database } from 'better-sqlite3'
import type { BookRow } from './db'
import {
  diffLayout, groupByShelf, layoutRange, locationLabel, NEWCOMER_ID, overflow,
  shelfLoads, stripAround, stripAt,
  type RangeStart,
  type Move, type Overflow, type Placed, type Separator, type SeparatorKind,
  type ShelfGroup, type Strip,
} from '../shared/layout'
import type { ShelfRange } from '../shared/shelving'

interface SeparatorRow {
  id: number
  shelf_range: ShelfRange
  kind: SeparatorKind
  starts_at: string
  position: number
  note: string
  created_at: string
}

/** A book row plus the camelCase key the pure layout code expects. */
export type ShelvedBook = BookRow & { sortKey: string }

const toSeparator = (row: SeparatorRow): Separator => ({
  id: row.id,
  range: row.shelf_range,
  kind: row.kind,
  startsAt: row.starts_at,
  position: row.position,
})

export class Shelves {
  constructor(private readonly db: Database) {}

  list(range: ShelfRange): Separator[] {
    return (
      this.db
        .prepare('SELECT * FROM separators WHERE shelf_range = ? ORDER BY position ASC')
        .all(range) as SeparatorRow[]
    ).map(toSeparator)
  }

  /** Which bookcase a range begins on. */
  private startOf(range: ShelfRange): RangeStart {
    const row = this.db
      .prepare('SELECT start_shelf, start_area FROM shelf_ranges WHERE shelf_range = ?')
      .get(range) as { start_shelf: number; start_area: number } | undefined
    return { shelf: row?.start_shelf ?? 1, area: row?.start_area ?? 0 }
  }

  /**
   * A checked-out book holds no position, so it is absent here. The layout
   * then closes up behind it the way the shelf does, which is what lets a
   * book be pulled out and refiled without the boundaries pretending it is
   * still taking up room.
   */
  private booksIn(range: ShelfRange, excludeId = 0): BookRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM books WHERE shelf_range = ? AND checked_out_at IS NULL
          ORDER BY sort_key ASC`,
      )
      .all(range) as BookRow[]
    return excludeId ? rows.filter((row) => row.id !== excludeId) : rows
  }

  /** Every book in a range, with the shelf it lands on. */
  layout(range: ShelfRange): Placed<ShelvedBook>[] {
    return layoutRange(
      this.booksIn(range).map((row) => ({ ...row, sortKey: row.sort_key })),
      this.list(range),
      this.startOf(range),
    )
  }

  groups(range: ShelfRange): ShelfGroup<ShelvedBook>[] {
    return groupByShelf(this.layout(range), this.list(range))
  }

  loads(range: ShelfRange) {
    return shelfLoads(this.layout(range), this.list(range))
  }

  /**
   * Which shelf a book with this sort key would land on.
   *
   * Works for a book that is not saved yet, which is the case that matters:
   * the shelving step has to name a real shelf before the book exists. Done by
   * laying the run out with the newcomer slotted in, so boundaries are honoured
   * rather than approximated from a neighbour.
   */
  shelfForSortKey(range: ShelfRange, sortKey: string): string {
    const start = this.startOf(range)
    return this.layoutWith(range, sortKey)
      .find((p) => p.book.id === NEWCOMER_ID)?.label
      ?? locationLabel(start.shelf, start.area)
  }

  /** The run laid out as though a book with this sort key were already in it. */
  private layoutWith(
    range: ShelfRange,
    sortKey: string,
    excludeId = 0,
  ): Placed<ShelvedBook>[] {
    const books = this.booksIn(range, excludeId)
      .map((row) => ({ ...row, sortKey: row.sort_key }))
    const merged = [...books, { id: NEWCOMER_ID, sortKey } as ShelvedBook]
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    return layoutRange(merged, this.list(range), this.startOf(range))
  }

  /** The shelf this book lands on, end on, with the gap it goes in. */
  strip(range: ShelfRange, sortKey: string, excludeId = 0): Strip<ShelvedBook> | null {
    return stripAround(this.layoutWith(range, sortKey, excludeId))
  }

  /** The shelf a book already sits on, and where along it. */
  stripOf(range: ShelfRange, bookId: number): { label: string; books: Placed<ShelvedBook>[]; index: number } | null {
    return stripAt(this.layout(range), bookId)
  }

  /** Where one book sits now, or '' if it is not shelved in this range. */
  labelFor(range: ShelfRange, bookId: number): string {
    return this.layout(range).find((p) => p.book.id === bookId)?.label ?? ''
  }

  /**
   * The person says a shelf will not take another book.
   *
   * Moves its last book to the front of the next shelf, creating that shelf
   * if it does not exist, and returns the single physical step to perform.
   * Nothing here decides whether the next shelf can cope: that is the next
   * question to ask, and the caller walks the chain one answer at a time.
   */
  overflow(
    range: ShelfRange,
    label: string,
    kindIfNew: SeparatorKind = 'shelf',
  ): { ok: boolean; error?: string; step?: Overflow; moves?: Move[] } {
    const before = this.layout(range)
    const known = groupByShelf(before, this.list(range)).map((g) => g.label)

    // Two different failures used to share one message, which sent you looking
    // at the shelf when the real problem was that the label never existed.
    if (!known.includes(label)) {
      return {
        ok: false,
        error: known.length
          ? `There is no shelf ${label}. Shelves here are ${known.join(', ')}.`
          : `There is no shelf ${label} yet; nothing has been shelved in this range.`,
      }
    }

    const step = overflow(before, this.list(range), label, kindIfNew)
    if (!step) {
      return {
        ok: false,
        error: `${label} holds only one book, so moving it along would just ` +
          'empty the shelf. Put the new book on the next shelf instead.',
      }
    }

    if (step.create) {
      this.db
        .prepare(
          `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
           VALUES (?, ?, ?, ?, '', ?)`,
        )
        .run(range, step.create.kind, step.create.startsAt,
             this.list(range).length, new Date().toISOString())
    } else if (step.shift) {
      this.db
        .prepare('UPDATE separators SET starts_at = ? WHERE id = ?')
        .run(step.shift.startsAt, step.shift.id)
    }

    return { ok: true, step, moves: this.movesSince(range, before) }
  }

  /** Remove a boundary and renumber the rest so positions stay contiguous. */
  remove(id: number): void {
    const row = this.db
      .prepare('SELECT * FROM separators WHERE id = ?')
      .get(id) as SeparatorRow | undefined
    if (!row) return

    const drop = this.db.transaction(() => {
      this.db.prepare('DELETE FROM separators WHERE id = ?').run(id)
      this.db
        .prepare(
          `UPDATE separators SET position = position - 1
            WHERE shelf_range = ? AND position > ?`,
        )
        .run(row.shelf_range, row.position)
    })
    drop()
  }

  /**
   * What physically has to move if this run of books becomes the new one.
   *
   * Called with the layout captured before a change so the caller can tell the
   * user which books to shift, rather than leaving the catalogue and the
   * shelves to drift apart.
   */
  movesSince(range: ShelfRange, before: Placed<ShelvedBook>[]): Move[] {
    return diffLayout(before, this.layout(range))
  }
}
