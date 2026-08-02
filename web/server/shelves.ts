/**
 * Separators, and the derived geography that falls out of them.
 *
 * Keeps all the SQL for shelf boundaries in one place. The arithmetic itself
 * lives in shared/layout.ts and stays pure.
 */

import type { Database } from 'better-sqlite3'
import type { BookRow } from './db'
import {
  diffLayout, groupByShelf, layoutRange, shelfLoads,
  type Move, type Placed, type Separator, type SeparatorKind, type ShelfGroup,
} from '../shared/layout'
import type { ShelfRange } from '../shared/shelving'

interface SeparatorRow {
  id: number
  shelf_range: ShelfRange
  kind: SeparatorKind
  capacity: number
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
  capacity: row.capacity,
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

  private booksIn(range: ShelfRange): BookRow[] {
    return this.db
      .prepare('SELECT * FROM books WHERE shelf_range = ? ORDER BY sort_key ASC')
      .all(range) as BookRow[]
  }

  /** Every book in a range, with the shelf it lands on. */
  layout(range: ShelfRange): Placed<ShelvedBook>[] {
    return layoutRange(
      this.booksIn(range).map((row) => ({ ...row, sortKey: row.sort_key })),
      this.list(range),
    )
  }

  groups(range: ShelfRange): ShelfGroup<ShelvedBook>[] {
    return groupByShelf(this.layout(range), this.list(range))
  }

  loads(range: ShelfRange) {
    return shelfLoads(this.layout(range), this.list(range))
  }

  /** Where one book sits now, or '' if it is not shelved in this range. */
  labelFor(range: ShelfRange, bookId: number): string {
    return this.layout(range).find((p) => p.book.id === bookId)?.label ?? ''
  }

  /**
   * Mark a shelf full after a given book.
   *
   * The click happens between two books in the list, but what gets stored is
   * the resulting capacity: how many books sit on that shelf up to and
   * including the one clicked. From then on the number is a fact about the
   * furniture, and which book happens to be last is free to change.
   */
  markFullAfter(
    range: ShelfRange,
    bookId: number,
    kind: SeparatorKind,
    note = '',
  ): { ok: boolean; error?: string; separator?: Separator } {
    const placed = this.layout(range)
    const index = placed.findIndex((p) => p.book.id === bookId)
    if (index === -1) {
      return { ok: false, error: 'That book is not on these shelves.' }
    }

    const target = placed[index]!
    const existing = this.list(range)

    // Only the last, open-ended shelf can be closed. Closing one that already
    // has a separator would need every later capacity renumbered, and the
    // honest fix is to remove the existing separator first.
    const isFinalShelf = placed
      .slice(index + 1)
      .every((p) => p.label === target.label) || index === placed.length - 1
    const closedShelves = existing.length
    const targetIsClosed = groupByShelf(placed, existing)
      .findIndex((g) => g.label === target.label) < closedShelves

    if (targetIsClosed) {
      return {
        ok: false,
        error: `${target.label} is already marked full. Remove that marker first.`,
      }
    }
    if (!isFinalShelf) {
      return { ok: false, error: 'Only the last shelf can be marked full.' }
    }

    // Books on this shelf up to and including the one clicked.
    const start = placed.findIndex((p) => p.label === target.label)
    const capacity = index - start + 1

    const result = this.db
      .prepare(
        `INSERT INTO separators (shelf_range, kind, capacity, position, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(range, kind, capacity, existing.length, note, new Date().toISOString())

    const separator = this.list(range).find((s) => s.id === Number(result.lastInsertRowid))
    return { ok: true, separator }
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

  /** Adjust a capacity directly, for when a shelf turns out to hold one more. */
  setCapacity(id: number, capacity: number): void {
    this.db
      .prepare('UPDATE separators SET capacity = ? WHERE id = ?')
      .run(Math.max(0, Math.trunc(capacity)), id)
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
