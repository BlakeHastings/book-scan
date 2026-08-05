/**
 * Separators, and the derived geography that falls out of them.
 *
 * Keeps all the SQL for shelf boundaries in one place. The arithmetic itself
 * lives in shared/layout.ts and stays pure.
 */

import type { BookRow } from './db'
import type { Db } from './driver'
import {
  boundaryMove, carryOn, diffLayout, groupByShelf, layoutRange, locationLabel,
  NEWCOMER_ID, overflow, shelfLoads, stripAround, stripAt, stripWithGap,
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

/**
 * Every public method here returns a promise, for the reason given on `Store`:
 * the driver this is heading for is asynchronous, so the shape changes first,
 * while a missed `await` is still a compile error.
 *
 * Order is the shelving logic, so the sequence of reads and writes inside each
 * method is exactly what it was. Every layout still comes from a read taken
 * before the write it is compared against, and every sort still happens on the
 * rows that read returned.
 *
 * The driver is behind `Db` (driver.ts) rather than named here, so this file no
 * longer knows which database it is talking to.
 */
export class Shelves {
  constructor(private readonly db: Db) {}

  async list(range: ShelfRange): Promise<Separator[]> {
    return (
      await this.db.all<SeparatorRow>(
        'SELECT * FROM separators WHERE shelf_range = ? ORDER BY position ASC',
        [range],
      )
    ).map(toSeparator)
  }

  /** Which bookcase a range begins on. */
  private async startOf(range: ShelfRange): Promise<RangeStart> {
    const row = await this.db.get<{ start_shelf: number; start_area: number }>(
      'SELECT start_shelf, start_area FROM shelf_ranges WHERE shelf_range = ?',
      [range],
    )
    return { shelf: row?.start_shelf ?? 1, area: row?.start_area ?? 0 }
  }

  /**
   * A checked-out book holds no position, so it is absent here. The layout
   * then closes up behind it the way the shelf does, which is what lets a
   * book be pulled out and refiled without the boundaries pretending it is
   * still taking up room.
   */
  private async booksIn(range: ShelfRange, excludeId = 0): Promise<BookRow[]> {
    const rows = await this.db.all<BookRow>(
      `SELECT * FROM books WHERE shelf_range = ? AND checked_out_at IS NULL
        ORDER BY sort_key ASC`,
      [range],
    )
    return excludeId ? rows.filter((row) => row.id !== excludeId) : rows
  }

  /** Every book in a range, with the shelf it lands on. */
  async layout(range: ShelfRange): Promise<Placed<ShelvedBook>[]> {
    return layoutRange(
      (await this.booksIn(range)).map((row) => ({ ...row, sortKey: row.sort_key })),
      await this.list(range),
      await this.startOf(range),
    )
  }

  async groups(range: ShelfRange): Promise<ShelfGroup<ShelvedBook>[]> {
    return groupByShelf(await this.layout(range), await this.list(range))
  }

  async loads(range: ShelfRange) {
    return shelfLoads(await this.layout(range), await this.list(range))
  }

  /**
   * Which shelf a book with this sort key would land on.
   *
   * Works for a book that is not saved yet, which is the case that matters:
   * the shelving step has to name a real shelf before the book exists. Done by
   * laying the run out with the newcomer slotted in, so boundaries are honoured
   * rather than approximated from a neighbour.
   */
  async shelfForSortKey(range: ShelfRange, sortKey: string): Promise<string> {
    const start = await this.startOf(range)
    return (await this.layoutWith(range, sortKey))
      .find((p) => p.book.id === NEWCOMER_ID)?.label
      ?? locationLabel(start.shelf, start.area)
  }

  /**
   * The run laid out as though a book with this sort key were already in it.
   *
   * The rows are read first and the newcomer merged into the array that read
   * returned, so the sort still runs over one consistent snapshot of the range
   * rather than over rows fetched either side of it.
   */
  private async layoutWith(
    range: ShelfRange,
    sortKey: string,
    excludeId = 0,
  ): Promise<Placed<ShelvedBook>[]> {
    const books = (await this.booksIn(range, excludeId))
      .map((row) => ({ ...row, sortKey: row.sort_key }))
    const merged = [...books, { id: NEWCOMER_ID, sortKey } as ShelvedBook]
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    return layoutRange(merged, await this.list(range), await this.startOf(range))
  }

  /** The shelf this book lands on, end on, with the gap it goes in. */
  async strip(
    range: ShelfRange,
    sortKey: string,
    excludeId = 0,
  ): Promise<Strip<ShelvedBook> | null> {
    return stripAround(await this.layoutWith(range, sortKey, excludeId))
  }

  /** The shelf a book already sits on, and where along it. */
  async stripOf(
    range: ShelfRange,
    bookId: number,
  ): Promise<{ label: string; books: Placed<ShelvedBook>[]; index: number } | null> {
    return stripAt(await this.layout(range), bookId)
  }

  /** Where one book sits now, or '' if it is not shelved in this range. */
  async labelFor(range: ShelfRange, bookId: number): Promise<string> {
    return (await this.layout(range)).find((p) => p.book.id === bookId)?.label ?? ''
  }

  /**
   * What saying "this shelf will not take another book" would do. Read only.
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
  private async planOverflow(
    range: ShelfRange,
    label: string,
    kindIfNew: SeparatorKind,
    placing: string,
  ): Promise<
    | { ok: false; error: string }
    | { ok: true; carry?: CarryOn; step?: Overflow; before: Placed<ShelvedBook>[];
        separators: Separator[] }
  > {
    const before = await this.layout(range)
    const separators = await this.list(range)

    /*
     * Before the cascade, and before the label is even checked against the
     * shelves that exist: a book being placed can be about to go on a plank
     * that a boundary move left bare, which has no books to name it and so is
     * absent from the groups below.
     */
    if (placing) {
      const carry = carryOn(
        await this.layoutWith(range, placing), separators, label, kindIfNew,
      )
      if (carry) return { ok: true, carry, before, separators }
    }

    const known = groupByShelf(before, separators).map((g) => g.label)

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

    const step = overflow(before, separators, label, kindIfNew)
    if (!step) {
      return {
        ok: false,
        error: `${label} holds only one book, so moving it along would just ` +
          'empty the shelf. Put the new book on the next shelf instead.',
      }
    }

    return { ok: true, step, before, separators }
  }

  /**
   * The move a full shelf would need, offered rather than made.
   *
   * Nothing here writes. The shelves are the record of where books physically
   * are, and until somebody has actually carried the book there is nothing to
   * record: a proposal is not an observation, which is the same rule #87
   * settled for metadata edits. The boundary used to shift the moment a step
   * was proposed, which made the book vanish off the plank the person was
   * still standing at and stay vanished if they walked away (#111).
   *
   * The strip is the proposed arrangement drawn: the destination plank as it
   * will look, with the gap where the book goes. Computed against the
   * separators the move WOULD produce, held in memory and never saved, so the
   * picture describes the thing being confirmed without making it true
   * (#112).
   */
  async proposeOverflow(
    range: ShelfRange,
    label: string,
    kindIfNew: SeparatorKind = 'shelf',
    placing = '',
  ): Promise<{
    ok: boolean
    error?: string
    carry?: CarryOn
    step?: Overflow
    strip?: Strip<ShelvedBook> | null
  }> {
    const plan = await this.planOverflow(range, label, kindIfNew, placing)
    if (!plan.ok) return { ok: false, error: plan.error }
    if (plan.carry) return { ok: true, carry: plan.carry }

    const step = plan.step!
    const books = (await this.booksIn(range))
      .map((row) => ({ ...row, sortKey: row.sort_key }))
    const after = layoutRange(
      books, this.separatorsAfter(plan.separators, step), await this.startOf(range),
    )

    return { ok: true, step, strip: stripWithGap(after, step.moved.id) }
  }

  /**
   * The separator list a plan would leave behind, without writing any of it.
   *
   * Exactly the edit `applyBoundary` makes, expressed over an array instead of
   * over the table, so the drawing and the write cannot describe different
   * shelves. The invented id is never stored and never read back: only
   * `startsAt` and `kind` reach the layout.
   */
  private separatorsAfter(
    separators: Separator[],
    plan: { create?: { startsAt: string; kind: SeparatorKind }; shift?: { id: number; startsAt: string } },
  ): Separator[] {
    if (plan.create) {
      return [...separators, {
        id: 0,
        range: separators[0]?.range ?? 'fiction',
        kind: plan.create.kind,
        startsAt: plan.create.startsAt,
        position: separators.length,
      }]
    }
    if (plan.shift) {
      return separators.map((s) =>
        s.id === plan.shift!.id ? { ...s, startsAt: plan.shift!.startsAt } : s)
    }
    return separators
  }

  /**
   * The person says they have carried the book, so the shelves change.
   *
   * The plan is recomputed here rather than carried over from whatever was
   * proposed a moment ago. That is the #106 rule applied to the cascade: an
   * answer is about the shelves as they are now, and a chain unwinding one
   * frame at a time (#110) confirms its outermost move last, long after the
   * proposal was drawn. `expectId` is the book the person was told to move,
   * and a mismatch is refused rather than quietly applied to a different one.
   *
   * The carry (#77) is applied without any of this, because there is nothing
   * to confirm: the book is in your hand, nothing already shelved moves, and
   * the placing question is simply re-asked against the plank it now goes on.
   */
  async overflow(
    range: ShelfRange,
    label: string,
    kindIfNew: SeparatorKind = 'shelf',
    placing = '',
    expectId = 0,
  ): Promise<{ ok: boolean; error?: string; step?: Overflow; carry?: CarryOn; moves?: Move[] }> {
    const plan = await this.planOverflow(range, label, kindIfNew, placing)
    if (!plan.ok) return { ok: false, error: plan.error }

    if (plan.carry) {
      await this.applyBoundary(range, plan.carry)
      return { ok: true, carry: plan.carry, moves: await this.movesSince(range, plan.before) }
    }

    const step = plan.step!
    if (expectId && step.moved.id !== expectId) {
      return {
        ok: false,
        error: `The shelves have changed since that was asked: ${label} now ends ` +
          'with a different book. Say there is no room again to see the move as ' +
          'it stands.',
      }
    }

    await this.applyBoundary(range, step)

    return { ok: true, step, moves: await this.movesSince(range, plan.before) }
  }

  /** Write the one boundary change a plan asks for. Shared by both answers. */
  private async applyBoundary(
    range: ShelfRange,
    plan: { create?: { startsAt: string; kind: SeparatorKind }; shift?: { id: number; startsAt: string } },
  ): Promise<void> {
    if (plan.create) {
      // Counted before the insert, exactly as it was: the new separator takes
      // the position after the ones already there.
      const position = (await this.list(range)).length
      await this.db.run(
        `INSERT INTO separators (shelf_range, kind, starts_at, position, note, created_at)
         VALUES (?, ?, ?, ?, '', ?)`,
        [range, plan.create.kind, plan.create.startsAt,
         position, new Date().toISOString()],
      )
    } else if (plan.shift) {
      await this.db.run(
        'UPDATE separators SET starts_at = ? WHERE id = ?',
        [plan.shift.startsAt, plan.shift.id],
      )
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
  async moveAcrossBoundary(
    range: ShelfRange,
    bookId: number,
    direction: BoundaryDirection,
  ): Promise<{ ok: boolean; error?: string; move?: BoundaryMove; moves?: Move[] }> {
    const before = await this.layout(range)
    const outcome = boundaryMove(before, await this.list(range), bookId, direction)

    if (!outcome.ok) {
      return { ok: false, error: refusal(outcome.reason, outcome.at, direction) }
    }

    // The shifts and the removals are one boundary change and have to land
    // together. `remove` opens a transaction of its own and is called from
    // inside this one, which is exactly the nesting `Db.tx` handles with a
    // savepoint, so it no longer needs a second synchronous body to be reached
    // from in here.
    await this.db.tx(async () => {
      for (const shift of outcome.move.shift) {
        await this.db.run(
          'UPDATE separators SET starts_at = ? WHERE id = ?',
          [shift.startsAt, shift.id],
        )
      }
      for (const id of outcome.move.remove) await this.remove(id)
    })

    return {
      ok: true,
      move: outcome.move,
      /*
       * Everything else that ended up somewhere new, which should be nothing.
       * The moved book is deliberately absent: it is in somebody's hand, and
       * where it landed is recorded through the location route rather than
       * handed back as a job still to do.
       */
      moves: (await this.movesSince(range, before)).filter((move) => move.id !== bookId),
    }
  }

  /**
   * Which plank a boundary move would land this book on, in each direction,
   * without moving anything.
   *
   * Runs the same rule `moveAcrossBoundary` enforces on the write, so a
   * screen can decide whether to offer the button before anybody taps it
   * (#96). That is a courtesy, not the rule itself: the write path checks
   * again regardless of what this said a moment ago, because a shelf can
   * change between the two calls.
   */
  async boundaryOptions(
    range: ShelfRange,
    bookId: number,
  ): Promise<{ next: string | null; previous: string | null }> {
    const placed = await this.layout(range)
    const separators = await this.list(range)
    const next = boundaryMove(placed, separators, bookId, 'next')
    const previous = boundaryMove(placed, separators, bookId, 'previous')
    return {
      next: next.ok ? next.move.to : null,
      previous: previous.ok ? previous.move.to : null,
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
  async review(range: ShelfRange): Promise<ShelvingReview> {
    const onShelf = (await this.layout(range))
      .map((placed) => toFiled(placed.book, placed.label, false))

    const off = (
      await this.db.all<BookRow>(
        `SELECT * FROM books WHERE shelf_range = ? AND checked_out_at IS NOT NULL
          ORDER BY sort_key ASC`,
        [range],
      )
    ).map((row) => toFiled(row, '', true))

    return reviewShelving([...onShelf, ...off])
  }

  /**
   * Remove a boundary and renumber the rest so positions stay contiguous.
   *
   * The read is outside the transaction and the two writes are inside it,
   * exactly as before. Called from inside `moveAcrossBoundary`'s transaction as
   * well as on its own, and `Db.tx` opens a savepoint rather than a second
   * transaction when that happens.
   */
  async remove(id: number): Promise<void> {
    const row = await this.db.get<SeparatorRow>(
      'SELECT * FROM separators WHERE id = ?',
      [id],
    )
    if (!row) return

    await this.db.tx(async (tx) => {
      await tx.run('DELETE FROM separators WHERE id = ?', [id])
      await tx.run(
        `UPDATE separators SET position = position - 1
          WHERE shelf_range = ? AND position > ?`,
        [row.shelf_range, row.position],
      )
    })
  }

  /**
   * What physically has to move if this run of books becomes the new one.
   *
   * Called with the layout captured before a change so the caller can tell the
   * user which books to shift, rather than leaving the catalogue and the
   * shelves to drift apart.
   */
  async movesSince(range: ShelfRange, before: Placed<ShelvedBook>[]): Promise<Move[]> {
    return diffLayout(before, await this.layout(range))
  }
}
