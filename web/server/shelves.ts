/**
 * Separators, and the derived geography that falls out of them.
 *
 * Keeps all the SQL for shelf boundaries in one place. The arithmetic itself
 * lives in shared/layout.ts and stays pure.
 */

import type { Database } from 'better-sqlite3'
import type { BookRow } from './db'
import {
  boundaryMove, carryOn, diffLayout, groupByShelf, layoutRange, locationLabel,
  NEWCOMER_ID, overflow, shelfLoads, stripAround, stripAt,
  type RangeStart,
  type BoundaryDirection, type BoundaryMove, type BoundaryRefusal, type CarryOn,
  type Move, type Overflow, type Placed, type Separator, type SeparatorKind,
  type ShelfGroup, type Strip,
} from '../shared/layout'
import {
  reviewShelving,
  type FiledBook, type ShelfRange, type ShelvingReview,
} from '../shared/shelving'

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

/** A row as the misfile check sees it: where it is, and where it belongs. */
const toFiled = (row: BookRow, derived: string, checkedOut: boolean): FiledBook => ({
  id: row.id,
  title: row.title,
  authorFiling: row.author_filing,
  location: row.location ?? '',
  derivedLocation: derived,
  sortKey: row.sort_key,
  checkedOut,
})

/**
 * Why a boundary move was refused, said to the person holding the book.
 *
 * Each reason gets its own sentence. Sharing one message between "that book is
 * in the middle of the plank" and "there is no plank that way" sends somebody
 * looking at the wrong thing, which is the mistake `overflow` above already
 * had to be taught once.
 */
function refusal(
  reason: BoundaryRefusal,
  at: string,
  direction: BoundaryDirection,
): string {
  if (reason === 'not-shelved') {
    return 'That book is not on a bookcase in this range, so it has no area ' +
      'to move out of.'
  }

  if (reason === 'not-at-boundary') {
    return `Only the first or last book of ${at} can move across its boundary. ` +
      'Any other book cannot move without putting the area out of order.'
  }

  return direction === 'next'
    ? `There is no area after ${at}. Say ${at} is full when you are placing a ` +
      'book, and the next one gets made then.'
    : `There is no area before ${at}; it is where this range starts.`
}

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
   * Two answers, and the first one is tried first on purpose.
   *
   * When the book being placed belongs at the END of that shelf, the book in
   * their hand is the one that moves: it goes to the start of the next shelf
   * and nothing already on a shelf is touched. `placing` is that book's sort
   * key, and it is what makes this case visible at all, because the book does
   * not exist yet and so is absent from every layout the database can produce.
   *
   * Otherwise the gap is in the middle, something genuinely has to come off
   * the end to open it, and the last book moves to the front of the next
   * shelf, creating that shelf if it does not exist. Nothing here decides
   * whether the next shelf can cope: that is the next question to ask, and the
   * caller walks the chain one answer at a time.
   */
  overflow(
    range: ShelfRange,
    label: string,
    kindIfNew: SeparatorKind = 'shelf',
    placing = '',
  ): { ok: boolean; error?: string; step?: Overflow; carry?: CarryOn; moves?: Move[] } {
    const before = this.layout(range)

    /*
     * Before the cascade, and before the label is even checked against the
     * shelves that exist: a book being placed can be about to go on a plank
     * that a boundary move left bare, which has no books to name it and so is
     * absent from the groups below.
     */
    if (placing) {
      const carry = carryOn(
        this.layoutWith(range, placing), this.list(range), label, kindIfNew,
      )
      if (carry) {
        this.applyBoundary(range, carry)
        return { ok: true, carry, moves: this.movesSince(range, before) }
      }
    }

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

    this.applyBoundary(range, step)

    return { ok: true, step, moves: this.movesSince(range, before) }
  }

  /** Write the one boundary change a plan asks for. Shared by both answers. */
  private applyBoundary(
    range: ShelfRange,
    plan: { create?: { startsAt: string; kind: SeparatorKind }; shift?: { id: number; startsAt: string } },
  ): void {
    if (plan.create) {
      this.db
        .prepare(
          `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
           VALUES (?, ?, ?, ?, '', ?)`,
        )
        .run(range, plan.create.kind, plan.create.startsAt,
             this.list(range).length, new Date().toISOString())
    } else if (plan.shift) {
      this.db
        .prepare('UPDATE separators SET starts_at = ? WHERE id = ?')
        .run(plan.shift.startsAt, plan.shift.id)
    }
  }

  /**
   * The first or last book of an area, carried to the plank next door.
   *
   * The rule lives here and in `boundaryMove`, not in the screen that offers
   * it. A button that only ever appears on the right book is one caller away
   * from being lost, and the caller after that would be writing a book into
   * the middle of another plank, which is precisely the state misfile
   * detection exists to report.
   *
   * This does not touch the location column. Where a book physically is was
   * observed by a person, and it is written through PATCH /api/books/:id/
   * location like every other observation, by whoever just moved the book.
   * What changes here is the furniture: an area boundary, re-anchored one
   * book along.
   */
  moveAcrossBoundary(
    range: ShelfRange,
    bookId: number,
    direction: BoundaryDirection,
  ): { ok: boolean; error?: string; move?: BoundaryMove; moves?: Move[] } {
    const before = this.layout(range)
    const outcome = boundaryMove(before, this.list(range), bookId, direction)

    if (!outcome.ok) {
      return { ok: false, error: refusal(outcome.reason, outcome.at, direction) }
    }

    const apply = this.db.transaction(() => {
      for (const shift of outcome.move.shift) {
        this.db
          .prepare('UPDATE separators SET starts_at = ? WHERE id = ?')
          .run(shift.startsAt, shift.id)
      }
      for (const id of outcome.move.remove) this.remove(id)
    })
    apply()

    return {
      ok: true,
      move: outcome.move,
      /*
       * Everything else that ended up somewhere new, which should be nothing.
       * The moved book is deliberately absent: it is in somebody's hand, and
       * where it landed is recorded through the location route rather than
       * handed back as a job still to do.
       */
      moves: this.movesSince(range, before).filter((move) => move.id !== bookId),
    }
  }

  /**
   * Which books in this range are not where the catalogue says they belong.
   *
   * The two halves of the comparison come from different places on purpose.
   * The recorded location is whatever a person last confirmed, read straight
   * off the row. The derived location is recomputed here from sort order and
   * the shelf boundaries, so inserting a book earlier in the alphabet, moving
   * a boundary, or editing an author all shift it while the recorded one
   * stays put.
   *
   * Strictly read only. Detection that quietly rewrote a location to make the
   * disagreement go away would destroy the record of where the book actually
   * is, which is the one thing that column is for.
   *
   * Checked-out books are pulled in explicitly. They are absent from the
   * layout, having no position, and dropping them silently would leave the
   * caller unable to tell "not misfiled" from "not considered".
   */
  review(range: ShelfRange): ShelvingReview {
    const onShelf = this.layout(range)
      .map((placed) => toFiled(placed.book, placed.label, false))

    const off = (
      this.db
        .prepare(
          `SELECT * FROM books WHERE shelf_range = ? AND checked_out_at IS NOT NULL
            ORDER BY sort_key ASC`,
        )
        .all(range) as BookRow[]
    ).map((row) => toFiled(row, '', true))

    return reviewShelving([...onShelf, ...off])
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
