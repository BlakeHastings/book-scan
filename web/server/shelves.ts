/**
 * Separators, and the derived geography that falls out of them.
 *
 * Keeps all the SQL for shelf boundaries in one place. The arithmetic itself
 * lives in shared/layout.ts and stays pure.
 */

import type { FiledBookRow } from './db.pg'
import type { Db } from './driver'
import { withPhotographs, type FiledPhotographedBook } from './photographs'
import { withPlacements, type PlacementFields } from './placement-ledger'
import {
  areaFaces, areaOfKey, bandOf, planksOf, runAreasOf,
  type Plank, type RunPlanks,
} from '../infrastructure/shelving/areas'
import type { AreaFace } from '../domain/placement/carry'
import type { LabelChange } from '../domain/placement/arrangement'
import { relabellingWithout } from './furniture'
import { CHECKED_OUT } from '../domain/books/state'
import { RangeSeparators } from '../domain/shelving/separators'
import { RemoveSeparatorHandler } from '../application/shelving/remove-separator'
import type {
  OutstandingMove, OutstandingMoveRepository, SeparatorRepository,
} from '../application/shelving/ports'
import { DrizzleOutstandingMoveRepository } from '../infrastructure/shelving/outstanding-move-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DbTransactions } from '../infrastructure/shelving/transactions'
import {
  boundaryMove, carryOn, diffLayout, groupByShelf, layoutRange, locationLabel,
  NEWCOMER_ID, overflow, shelfLoads, stripAround, stripAt, stripWithGap,
  type PlankAt, type RangeStart,
  type BoundaryDirection, type BoundaryMove, type BoundaryRefusal, type CarryOn,
  type Move, type Overflow, type Placed, type Separator, type SeparatorKind,
  type ShelfGroup, type Strip,
} from '../shared/layout'
import {
  reviewShelving,
  type FiledBook, type ShelfRange, type ShelvingReview,
} from '../shared/shelving'

/**
 * The name every transaction that reads a shelf range and then writes to it
 * serialises on. See `TxOptions` in driver.ts for why a transaction alone is
 * not enough.
 *
 * One name per range, and that is the whole design. Books and separators in a
 * range are one thing: `addBook` reads the neighbours in a range before
 * inserting into it, `overflow` reads the layout of a range before adding a
 * boundary to it, and `moveAcrossBoundary` reads both before moving one. Two of
 * those in flight over the same range have to take turns or they compute a
 * placement each from a shelf the other is halfway through changing. Two over
 * *different* ranges never touch the same rows, and nothing that only reads
 * waits for either.
 */
export const rangeLock = (range: ShelfRange): string => `shelf:${range}`

/**
 * A book row plus the camelCase key the pure layout code expects.
 *
 * `FiledPhotographedBook`, not `BookRow`, and for two reasons that arrived
 * together. A shelf is drawn as a row of spines and a spine is a photograph, so
 * every book that reaches the layout arrives with the current photograph of each
 * kind joined onto it (#228); and a spine is captioned with what the book files
 * under, which is a fact about its first credit's alias and is joined on by the
 * view (#227). See `withPhotographs` and `FiledBookRow`.
 */
export type ShelvedBook = FiledPhotographedBook & PlacementFields & { sortKey: string }

/**
 * A row as the misfile check sees it: where it is, and where it belongs.
 *
 * **Both sides arrive as an area and a label, and the area is the answer.** The
 * label each side reads as comes from the same `labelFor`, so the two sides
 * agree about what a place is called as well as about which place it is; before
 * #356 one side was rendered by the ledger and the other by the ordinal walk,
 * and naming a bookcase made them two vocabularies for one plank.
 */
const toFiled = (
  row: FiledBookRow & PlacementFields,
  at: number | null,
  belongs: number | null,
  faces: Map<number, AreaFace>,
  checkedOut: boolean,
): FiledBook => ({
  id: row.id,
  title: row.title,
  authorFiling: row.author_filing,
  authors: row.authors,
  location: (at === null ? '' : faces.get(at)?.label) ?? '',
  areaId: at,
  derivedLocation: (belongs === null ? '' : faces.get(belongs)?.label) ?? '',
  derivedAreaId: belongs,
  standing: at === null || !faces.has(at) ? null : {
    fixture: faces.get(at)!.fixturePosition,
    plank: faces.get(at)!.areaPosition,
  },
  sortKey: row.sort_key,
  checkedOut,
})

/**
 * Where a plan takes a book, said both ways at both ends.
 *
 * **The label is what somebody reads and the id is what decides.** A plan comes
 * out of shared/layout.ts naming its two planks in ordinals, because ordinals
 * are all the arithmetic there can know; this is that plan joined back to the
 * furniture, so a screen can put "Hall shelf · B" in front of a person and send
 * the plank itself back when they say they have carried the book. #359: the
 * button used to say `1B` on a piece whose every other screen said `Hall
 * shelf · B`, and the string it said was also the key it sent.
 */
export interface Planks {
  from: Plank
  to: Plank
}

/**
 * One direction a boundary move is open in, and what taking it costs.
 *
 * The plank half is #359's: the button says what the plank is called and sends
 * the plank itself. `empties` is #433's, and it is here because the offer said
 * nothing about the one move that removes furniture. A book alone in an area is
 * both the first and the last book of it, so both directions are open to it
 * (docs/shelving.md, "The only book in an area"), and taking either leaves the
 * area with no books to name, which takes it off the piece. That is the same
 * act #281 built a dialog for, arrived at from a different screen, and a screen
 * cannot ask before it unless the offer says it is coming.
 */
export interface BoundaryOffer extends Plank {
  /** Null for the ordinary move, which re-anchors a boundary and removes nothing. */
  empties: Emptying | null
}

/** The areas a move takes off the furniture, and what reads differently after. */
export interface Emptying {
  /** What each of them is called today, in the order they sit. */
  areas: string[]
  /** Every label that reads differently once they are gone, old to new. */
  becomes: LabelChange[]
}

/**
 * Why a boundary move was refused, said to the person holding the book.
 *
 * Each reason gets its own sentence. Sharing one message between "that book is
 * in the middle of the plank" and "there is no plank that way" sends somebody
 * looking at the wrong thing, which is the mistake `overflow` above already
 * had to be taught once.
 *
 * `at` is the plank named the way the book's own page names it, not the way the
 * layout numbers it. A refusal is read by the person who just tapped the button,
 * and a sentence about `1A` on a bookcase they have called the hall shelf is the
 * app disagreeing with itself in front of them.
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
 * A retraction that will not be carried out, thrown so the transaction rolls
 * back with it.
 *
 * A refusal here has to undo the part of the restore that already ran, which a
 * returned value cannot do from inside the transaction. It is caught at the one
 * place it is thrown from and turned back into the same `{ ok: false, error }`
 * every other refusal in this file returns, so nothing outside sees an
 * exception.
 */
class RetractionRefused extends Error {}

/**
 * Said when the shelves have changed since the move, so putting them back would
 * not put the book back.
 *
 * One sentence for both ways of finding out, because they are the same fact
 * from the person's side: something else moved, and the way out is the one that
 * was always there, which is to say where the book actually is.
 */
const SHELVES_MOVED_ON =
  'The shelves have changed since that move, so it cannot be taken back ' +
  'without moving something else. Say where the book actually is instead.'

/**
 * What a move is about to change, said as what it would take to change it back.
 *
 * Built from the boundaries as they stand **before** the move, which is the only
 * moment the answer exists: afterwards the shifted ones carry their new anchor
 * and the removed ones carry nothing.
 *
 * A re-created boundary keeps its kind, its anchor and its position, which is
 * everything that decides where a book lands. It does not keep a note or a
 * creation time, because `Separator` carries neither: the shelving code has
 * never written a note, and a boundary that had to be made again was, in fact,
 * made again. Faking the original timestamp would be the receipt asserting
 * something that did not happen.
 */
function receiptFor(
  range: ShelfRange,
  bookId: number,
  move: BoundaryMove,
  before: Separator[],
  now: string,
): OutstandingMove {
  const was = new Map(before.map((one) => [one.id, one]))

  return {
    bookId,
    range,
    from: move.from,
    to: move.to,
    reanchor: move.shift.flatMap((shift) => {
      const original = was.get(shift.id)
      return original ? [{ id: shift.id, startsAt: original.startsAt }] : []
    }),
    recreate: move.remove.flatMap((id) => {
      const original = was.get(id)
      if (!original) return []
      return [{
        range,
        kind: original.kind,
        startsAt: original.startsAt,
        position: original.position,
        note: '',
        createdAt: now,
      }]
    }),
  }
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
 *
 * **Separators no longer have any SQL in this file** (#172). They go through
 * `SeparatorRepository`, and the removal, which is the write with an invariant
 * to protect, goes through a command handler in `application/`. Books, ranges
 * and the misfile review still read straight through `Db` here: fourteen tables
 * are coming and the pattern is being judged on one first.
 */
export class Shelves {
  /**
   * The two collaborators default to the real ones, so `new Shelves(db)` still
   * means what it did and no existing caller or test had to change. `index.ts`
   * passes them in because the route that removes a boundary calls the handler
   * itself rather than going back through this class.
   */
  constructor(
    private readonly db: Db,
    private readonly separators: SeparatorRepository = new DrizzleSeparatorRepository(db),
    private readonly removeSeparator: RemoveSeparatorHandler =
      new RemoveSeparatorHandler(separators, new DbTransactions(db, rangeLock)),
    private readonly outstanding: OutstandingMoveRepository =
      new DrizzleOutstandingMoveRepository(db),
  ) {}

  async list(range: ShelfRange): Promise<Separator[]> {
    return this.separators.inRange(range)
  }

  /**
   * Which bookcase a range begins on.
   *
   * `shelf_ranges.start_shelf` until #232, and the rule that claims this range's
   * books now: it points at a fixture, and the fixture's position is the number
   * the column held. `0013` derived one from the other, so the two agree row for
   * row.
   *
   * The fallback is the first bookcase, which is what a missing row gave. It is
   * reachable on a collection whose rules point at furniture that has been taken
   * out, and it is the answer that draws a shelf rather than none.
   */
  private async startOf(range: ShelfRange): Promise<RangeStart> {
    return (await bandOf(this.db, range))?.start ?? { shelf: 1, area: 0 }
  }

  /**
   * The books on a shelf in this range, in order. Every layout, every strip,
   * every boundary decision and the misfile review are drawn from this one
   * statement, which is why it reads `shelved_books` and not `books` (#183).
   *
   * A checked-out book holds no position, so it is absent here. The layout
   * then closes up behind it the way the shelf does, which is what lets a
   * book be pulled out and refiled without the boundaries pretending it is
   * still taking up room. That used to be `checked_out_at IS NULL` and is now
   * one state of seven, and the same rows either way: the view's predicate is
   * the only place the condition is written, so a state that must not reach a
   * shelf cannot reach one by this statement being forgotten.
   */
  private async booksIn(
    range: ShelfRange,
    excludeId = 0,
  ): Promise<(FiledPhotographedBook & PlacementFields)[]> {
    // The photographs and the placements are joined on here, one statement each
    // for the whole range, because a shelf is drawn as a row of spines and a
    // spine is a photograph (#228), and the misfile review reads what a person
    // last said about every one of them (#232). Asking per book would be two
    // statements per book on the path that draws the library.
    const rows = await withPlacements(this.db, await withPhotographs(
      this.db,
      await this.db.all<FiledBookRow>(
        `SELECT * FROM shelved_books WHERE shelf_range = ?
          ORDER BY sort_key ASC`,
        [range],
      ),
    ))
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
   * The whole run drawn once: the boundaries, the shelves and what is on each.
   *
   * `groups` and `loads` are the same picture counted two ways, and reading them
   * separately laid the run out twice for one screen. Worth having as one method
   * rather than as two calls a route remembers to make together, because they
   * are also then answered off one snapshot: a book saved between the two reads
   * used to appear on a shelf whose count did not include it.
   */
  async shelving(range: ShelfRange): Promise<{
    groups: ShelfGroup<ShelvedBook>[]
    separators: Separator[]
    loads: { label: string; count: number }[]
  }> {
    const separators = await this.list(range)
    const placed = layoutRange(
      (await this.booksIn(range)).map((row) => ({ ...row, sortKey: row.sort_key })),
      separators,
      await this.startOf(range),
    )
    const groups = groupByShelf(placed, separators)
    // `shelfLoads` is `groupByShelf` and a count, so the count is taken off the
    // groups already in hand rather than by grouping the same layout again.
    return {
      groups,
      separators,
      loads: groups.map((group) => ({ label: group.label, count: group.books.length })),
    }
  }

  /**
   * Which shelf a book with this sort key would land on.
   *
   * Works for a book that is not saved yet, which is the case that matters:
   * the shelving step has to name a real shelf before the book exists.
   */
  async shelfForSortKey(range: ShelfRange, sortKey: string): Promise<string> {
    return (await this.shelvesForSortKeys(range, [sortKey]))[0]!
  }

  /**
   * The same question asked about many keys at once, which is one read rather
   * than one read each.
   *
   * **This is #332's finding 1.** `GET /api/shelves` asked `shelfForSortKey` once
   * per checked-out book, and that method used to lay the entire run out to
   * answer, so the shelves screen was O(checked-out x books-in-range) on the one
   * screen somebody opens while standing at a bookcase. Measured at 600 books it
   * went from 55 ms with nothing out to 1497 ms with two hundred out, and both
   * factors grow with the collection.
   *
   * **The books were never consulted.** Read `layoutRange`: it walks the run in
   * order and steps a boundary whenever `startsAt <= book.sortKey`, so where a
   * key lands is decided by the boundaries it has passed and by where the range
   * begins, and by nothing about the other books. They are carried through the
   * loop and never asked anything. So laying a hundred keys out together gives
   * each one exactly the answer that laying it out among six hundred books gave,
   * and `shelvesForSortKeys` is that same function applied to a list. It is
   * `shelfForSortKey` that is now defined in terms of this, so there is one
   * implementation and not two that must agree.
   *
   * `shelves.test.ts` holds the proof rather than the argument: the two are
   * compared over a seeded run, every book and every gap between books.
   */
  async shelvesForSortKeys(range: ShelfRange, sortKeys: string[]): Promise<string[]> {
    if (!sortKeys.length) return []

    // `layoutRange` requires sort order, so the keys are ordered and put back
    // afterwards by the position each one arrived in.
    const ordered = sortKeys
      .map((sortKey, at) => ({ id: at, sortKey }))
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))

    const placed = layoutRange(ordered, await this.list(range), await this.startOf(range))

    const labels = new Array<string>(sortKeys.length).fill('')
    for (const one of placed) labels[one.book.id] = one.label
    return labels
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

  /**
   * Everything standing on one plank right now, in the order it stands there.
   *
   * **Not the layout, and that is the whole of why it exists** (#429). The
   * layout answers where a book *belongs*, which is a question about the rules;
   * this answers what is *on* the plank, which is a question about the room. A
   * person carrying a book to `3A` is looking at whatever is on `3A`, including
   * the books they carried there ten seconds ago and anything the rules have no
   * opinion about, and none of that is what a run laid out by sort key draws.
   *
   * `current_area_id`, which is the projection of the ledger's `placed` rows and
   * is indexed with the sort key, so this is an index seek rather than a read of
   * a whole range. Same reading `tripAtArea` makes at the other end of the walk,
   * so the plank a person is told about and the plank the finished screen draws
   * cannot come from two different answers.
   */
  async standingOn(areaId: number, excludeId = 0): Promise<ShelvedBook[]> {
    const rows = await withPlacements(this.db, await withPhotographs(
      this.db,
      await this.db.all<FiledBookRow>(
        'SELECT * FROM shelved_books WHERE current_area_id = ? ORDER BY sort_key ASC',
        [areaId],
      ),
    ))
    return rows
      .filter((row) => row.id !== excludeId)
      .map((row) => ({ ...row, sortKey: row.sort_key }))
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
  ): Promise<
    { label: string; at: PlankAt; books: Placed<ShelvedBook>[]; index: number } | null
  > {
    return stripAt(await this.layout(range), bookId)
  }

  /** Where one book sits now, or '' if it is not shelved in this range. */
  async labelFor(range: ShelfRange, bookId: number): Promise<string> {
    return (await this.layout(range)).find((p) => p.book.id === bookId)?.label ?? ''
  }

  /**
   * The same question answered as the plank, which is what a write needs.
   *
   * `labelFor` above says what to call the place; this says which place it is.
   * The save route asks this one, because what it does with the answer is record
   * a book on it (#359).
   */
  async areaOf(range: ShelfRange, bookId: number): Promise<number | null> {
    const on = (await this.layout(range)).find((p) => p.book.id === bookId)
    if (!on) return null
    return (await this.planks(range)).at({ shelf: on.shelf, area: on.area }).areaId
  }

  /** This run's planks, each ready to be identified or named. See `RunPlanks`. */
  async planks(range: ShelfRange): Promise<RunPlanks> {
    return planksOf(this.db, range)
  }

  /**
   * The address the layout gives the plank an id names, or null when this run
   * has no such plank.
   *
   * **The one door between what a screen sends and what the cascade
   * understands** (#359). Everything in shared/layout.ts addresses a plank by
   * two ordinals and renders them as `1B`, because ordinals are all pure
   * arithmetic over a run can know. A screen sends the area, because an area is
   * the only thing that stays the same place when somebody names the bookcase it
   * is on. This is where one becomes the other, and it is deliberately the only
   * such place: a second one would be a second opinion about which plank a
   * button meant, and this one writes.
   *
   * Null is a refusal and not a fallback. An id from another run, an id for a
   * plank that has been taken out, an id for nothing at all: all of them mean
   * the caller is not talking about a plank of this run, and moving a real book
   * on a guess is the whole hazard here.
   */
  async addressOf(range: ShelfRange, areaId: number): Promise<PlankAt | null> {
    return (await this.planks(range)).addressOf(areaId)
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
    at: PlankAt,
    kindIfNew: SeparatorKind,
    placing: string,
  ): Promise<
    | { ok: false; error: string }
    | { ok: true; carry?: CarryOn; step?: Overflow; before: Placed<ShelvedBook>[];
        separators: Separator[] }
  > {
    // The address rendered, which is the key the cascade in shared/layout.ts
    // groups by. It goes no further than this file: what leaves here is the
    // plank, said the way `Planks` says it.
    const label = locationLabel(at.shelf, at.area)
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

    const groups = groupByShelf(before, separators)
    const planks = await this.planks(range)
    // Named for a person, because these two sentences are read rather than
    // acted on, and a bookcase somebody has named reads by that name
    // everywhere else on the same screen.
    const here = planks.at(at).label || label

    // Two different failures used to share one message, which sent you looking
    // at the shelf when the real problem was that the label never existed.
    if (!groups.some((g) => g.label === label)) {
      const said = groups.map((g) => planks.at({ shelf: g.shelf, area: g.area }).label)
      return {
        ok: false,
        error: said.length
          ? `There is no shelf ${here}. Shelves here are ${said.join(', ')}.`
          : `There is no shelf ${here} yet; nothing has been shelved in this range.`,
      }
    }

    const step = overflow(before, separators, label, kindIfNew)
    if (!step) {
      return {
        ok: false,
        error: `${here} holds only one book, so moving it along would just ` +
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
    at: PlankAt,
    kindIfNew: SeparatorKind = 'shelf',
    placing = '',
  ): Promise<{
    ok: boolean
    error?: string
    carry?: CarryOn
    step?: Overflow
    strip?: Strip<ShelvedBook> | null
    /** The two planks the answer is about, identified and named. */
    planks?: Planks
  }> {
    const plan = await this.planOverflow(range, at, kindIfNew, placing)
    if (!plan.ok) return { ok: false, error: plan.error }
    if (plan.carry) {
      return { ok: true, carry: plan.carry, planks: await this.naming(range, plan.carry) }
    }

    const step = plan.step!
    const books = (await this.booksIn(range))
      .map((row) => ({ ...row, sortKey: row.sort_key }))
    const after = layoutRange(
      books, this.separatorsAfter(plan.separators, step), await this.startOf(range),
    )

    return {
      ok: true,
      step,
      strip: stripWithGap(after, step.moved.id),
      planks: await this.naming(range, step),
    }
  }

  /**
   * A plan's two planks, joined back to the furniture.
   *
   * Read after the plan rather than before, so that a plank the plan has just
   * made comes back with the id it was given: `overflow` below applies the
   * boundary and then asks, which is what lets a screen record the book on the
   * plank it went on rather than on a name for it.
   */
  private async naming(
    range: ShelfRange,
    plan: { fromAt: PlankAt; toAt: PlankAt },
  ): Promise<Planks> {
    const planks = await this.planks(range)
    return { from: planks.at(plan.fromAt), to: planks.at(plan.toAt) }
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
    at: PlankAt,
    kindIfNew: SeparatorKind = 'shelf',
    placing = '',
    expectId = 0,
  ): Promise<{
    ok: boolean
    error?: string
    step?: Overflow
    carry?: CarryOn
    moves?: Move[]
    /** The two planks the move was about, identified and named. */
    planks?: Planks
  }> {
    /*
     * Plan, check and apply are one unit, which they had stopped being.
     *
     * `expectId` above is an optimistic-concurrency check, and until stage G it
     * was performed outside any transaction, so it did not close the window it
     * names: two people confirming there is no room on the same shelf both read
     * the same layout, both computed the same last book, both passed the check
     * and both applied. The result was either one separator shifted twice, so
     * two books were pushed off a plank when one was physically carried, or two
     * separators created at the same position, after which `list`'s ORDER BY
     * returns them in no fixed order and the same shelf label points at
     * different runs of books between requests.
     *
     * Reading and writing the same range now takes turns. See `rangeLock`.
     */
    return this.db.tx(async () => {
      const plan = await this.planOverflow(range, at, kindIfNew, placing)
      if (!plan.ok) return { ok: false, error: plan.error }

      if (plan.carry) {
        await this.applyBoundary(range, plan.carry)
        return {
          ok: true,
          carry: plan.carry,
          moves: await this.movesSince(range, plan.before),
          planks: await this.naming(range, plan.carry),
        }
      }

      const step = plan.step!
      if (expectId && step.moved.id !== expectId) {
        return {
          ok: false,
          error: 'The shelves have changed since that was asked: ' +
            `${(await this.planks(range)).at(at).label} now ends ` +
            'with a different book. Say there is no room again to see the move as ' +
            'it stands.',
        }
      }

      await this.applyBoundary(range, step)

      return {
        ok: true,
        step,
        moves: await this.movesSince(range, plan.before),
        // After the write, so a plank this step has just made comes back with
        // the id it was given rather than as a plank nothing can name.
        planks: await this.naming(range, step),
      }
    }, { serialiseOn: rangeLock(range) })
  }

  /** Write the one boundary change a plan asks for. Shared by both answers. */
  private async applyBoundary(
    range: ShelfRange,
    plan: { create?: { startsAt: string; kind: SeparatorKind }; shift?: { id: number; startsAt: string } },
  ): Promise<void> {
    if (plan.create) {
      // Counted before the insert, exactly as it was: the new separator takes
      // the position after the ones already there. `nextPosition` is the same
      // number the length was, and says so in the domain rather than here.
      const position = RangeSeparators
        .of(range, await this.separators.inRange(range))
        .nextPosition
      await this.separators.add({
        range,
        kind: plan.create.kind,
        startsAt: plan.create.startsAt,
        position,
        note: '',
        createdAt: new Date().toISOString(),
      })
    } else if (plan.shift) {
      await this.separators.reanchor(plan.shift.id, plan.shift.startsAt)
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
   *
   * **Except when it is the whole area** (#433). Moving the only book off a
   * plank leaves the area with no books to name, so the move takes the area off
   * the piece, and #281 settled that removing an area says what it will do and
   * asks first. `told` is that assent, and it is checked here rather than in the
   * screen for the same reason the edge rule is: a control that only appears
   * after a dialog is one caller away from being lost, and the caller after that
   * is a tap that deletes furniture with nothing said. `boundaryOptions` is what
   * lets a screen know the question is coming.
   */
  async moveAcrossBoundary(
    range: ShelfRange,
    bookId: number,
    direction: BoundaryDirection,
    told: { theAreaGoes: boolean } = { theAreaGoes: false },
  ): Promise<{
    ok: boolean
    error?: string
    move?: BoundaryMove
    moves?: Move[]
    /** The two planks the book crossed between, identified and named. */
    planks?: Planks
    /** What the refused move would have taken off the furniture. */
    empties?: Emptying | null
  }> {
    /*
     * The read that decides the move is inside the transaction with the writes
     * it decides, which it was not until stage G. The transaction used to open
     * around the shifts and removals only, which made those atomic with respect
     * to each other and nothing else: a concurrent overflow landing between the
     * layout read and the first UPDATE meant `starts_at` was written from a
     * layout that no longer existed, and the boundary jumped to a book now in
     * the middle of a plank. That is exactly the state `refusal('not-at-
     * boundary')` exists to prevent, arrived at from the other side.
     *
     * `remove` opens a transaction of its own and is called from inside this
     * one, which is the nesting `Db.tx` handles with a savepoint.
     */
    return this.db.tx(async () => {
      const before = await this.layout(range)
      const boundaries = await this.list(range)
      const outcome = boundaryMove(before, boundaries, bookId, direction)

      if (!outcome.ok) {
        // The plank the sentence is about, named the way the book's own page
        // names it. A refusal that says `1A` on a bookcase somebody has called
        // the hall shelf is the app disagreeing with itself in front of them.
        const said = outcome.atAt
          ? (await this.planks(range)).at(outcome.atAt).label || outcome.at
          : outcome.at
        return { ok: false, error: refusal(outcome.reason, said, direction) }
      }

      /*
       * The one move that removes furniture, refused until somebody has been
       * told it does.
       *
       * Nothing has been written at this point: the reads above decide, and the
       * three statements that change anything are below. So a caller that has
       * not asked gets the sentence and a room exactly as it was, which is what
       * the old path could not offer, because by the time it could have said
       * anything the area was gone.
       */
      if (outcome.move.remove.length > 0 && !told.theAreaGoes) {
        const going = await this.emptying(range, outcome.move)
        return {
          ok: false,
          error: `${going!.areas.join(' and ')} would have no books left on it, so `
            + 'moving this one takes it off the furniture. Nothing has been changed.',
          empties: going,
        }
      }

      /*
       * Written before the change, because it is a record of what the change is
       * about to undo. Reading the boundaries afterwards would give their new
       * anchors, and reading them for a removal would give nothing at all.
       */
      const now = new Date().toISOString()
      await this.outstanding.record(
        receiptFor(range, bookId, outcome.move, boundaries, now),
        now,
      )

      // The whole set at once. A move that empties an area re-anchors two
      // boundaries sharing one anchor, and where a boundary sits in the run is
      // decided by its anchor, so applying them one at a time leaves the second
      // with nothing to do. See `reanchorAll`.
      await this.separators.reanchorAll(outcome.move.shift)
      for (const id of outcome.move.remove) await this.remove(id)

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
        /*
         * Read after the boundaries moved, which is what the person is about to
         * act on: they carry the book, then say it is there, and what they send
         * is `planks.to.areaId`. Both planks exist either side of a boundary
         * move, since it refuses at the ends of the run rather than making
         * furniture, so neither id here is ever null.
         */
        planks: await this.naming(range, outcome.move),
      }
    }, { serialiseOn: rangeLock(range) })
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
   *
   * **A plank each way, not a label each way** (#359). The button that reads
   * this says "Move it on to ..." on the same screen as the book's recorded
   * location, so what it says has to come from the same `labelFor`; and #358
   * left `areasForSortKeys` answering where a run puts a key as a row rather
   * than as a string, which is the shape reused here.
   *
   * **And what the move costs, not only where it goes** (#433). A book alone in
   * an area is offered both directions and either of them takes the area off the
   * piece, which is the same act the furniture screen asks about before doing.
   * The screen cannot ask about something the offer does not mention, so the
   * offer mentions it, read from the same outcome the write path enforces.
   */
  async boundaryOptions(
    range: ShelfRange,
    bookId: number,
    /** The run's planks, when the caller has already read them. */
    known?: RunPlanks,
  ): Promise<{ next: BoundaryOffer | null; previous: BoundaryOffer | null }> {
    const placed = await this.layout(range)
    const separators = await this.list(range)
    const planks = known ?? await this.planks(range)
    const next = boundaryMove(placed, separators, bookId, 'next')
    const previous = boundaryMove(placed, separators, bookId, 'previous')
    const offer = async (outcome: typeof next): Promise<BoundaryOffer | null> =>
      (outcome.ok
        ? {
            ...planks.at(outcome.move.toAt),
            empties: await this.emptying(range, outcome.move, planks),
          }
        : null)

    return { next: await offer(next), previous: await offer(previous) }
  }

  /**
   * The areas a move takes off the furniture, or null when it takes none.
   *
   * Read off `move.remove`, which is the boundary list the write path is about
   * to delete, and a boundary's id is the area it opens (`boundariesFrom`). So
   * the question and the answer are the same rows rather than two readings of
   * one room, which is the mistake `areaDisagreements` exists to catch.
   */
  private async emptying(
    range: ShelfRange,
    move: BoundaryMove,
    known?: RunPlanks,
  ): Promise<Emptying | null> {
    if (move.remove.length === 0) return null
    const planks = known ?? await this.planks(range)
    return {
      areas: move.remove.map((id) => planks.labelOf(id)).filter(Boolean),
      becomes: await relabellingWithout(this.db, move.remove),
    }
  }

  /**
   * Take back a move nobody acted on, and put the boundaries where they were.
   *
   * The counterpart to `moveAcrossBoundary` and deliberately not a second call
   * to it. A move is an assignment; this is the assignment withdrawn, and the
   * difference shows up in two places that matter.
   *
   * **Nothing here writes a location**, and that is the whole point. The book
   * never left the plank the catalogue records it on, so there is nothing about
   * the room to write down. Retracting by recording a placement and moving
   * again would put a statement in the catalogue that nobody made, which is
   * exactly the lie #196 exists to stop the app from asking for.
   *
   * **"Back" means where the boundaries were, not where the rules would put
   * them now.** Asking for the opposite boundary move would answer the second
   * question. After a move that emptied an area, two boundaries sit on the same
   * anchor, and the opposite move re-anchors both, carrying the book two planks
   * instead of one (see `boundariesBetween` in shared/layout.ts). So the undo is
   * replayed from the receipt written when the move was made, and then checked:
   * if the book does not land back on the plank the catalogue records, the whole
   * thing rolls back and says so rather than leaving the shelves somewhere
   * neither the person nor the catalogue asked for.
   */
  async retractMove(
    range: ShelfRange,
    bookId: number,
  ): Promise<{
    ok: boolean
    error?: string
    /** Which way the book went back, named the way a move names it. */
    move?: { from: string; to: string }
    moves?: Move[]
    /** The two planks the book came back between, identified and named. */
    planks?: Planks
  }> {
    try {
      return await this.db.tx(async () => {
        const receipt = await this.outstanding.forBook(bookId)
        if (!receipt || receipt.range !== range) {
          throw new RetractionRefused(
            'There is no move outstanding on that book, so there is nothing to ' +
            'take back. If it is on the wrong plank, say where it actually is.',
          )
        }

        const before = await this.layout(range)

        // The whole receipt at once, for the reason the move applies its shifts
        // at once: a move that emptied an area left two boundaries on one
        // anchor, and putting them back one at a time puts only one back.
        await this.separators.reanchorAll(receipt.reanchor)

        // In position order, and only onto the end of the run. A move removes
        // boundaries only when its book would be past the last one, so what is
        // being put back is always the tail; anywhere else and `position` would
        // collide with a boundary somebody added since, which is the invariant
        // `RangeSeparators` exists to hold.
        const recreate = [...receipt.recreate].sort((a, b) => a.position - b.position)
        if (recreate.length) {
          const next = RangeSeparators.of(range, await this.list(range)).nextPosition
          if (next !== recreate[0]!.position) throw new RetractionRefused(SHELVES_MOVED_ON)
          for (const one of recreate) await this.separators.add(one)
        }

        const landed = (await this.layout(range)).find((placed) => placed.book.id === bookId)
        if (!landed || landed.label !== receipt.from) {
          throw new RetractionRefused(SHELVES_MOVED_ON)
        }

        await this.outstanding.clear(bookId)

        /*
         * Both planks read off the layout rather than out of the receipt: the
         * receipt holds two ordinals written when the move was made, and the
         * piece may have been named since. Where the book was is the layout as
         * it stood before this undo, and where it is now is where it landed,
         * which are the same two planks the receipt names and are named here the
         * way every other screen names them.
         */
        const was = before.find((placed) => placed.book.id === bookId)
        const planks = await this.planks(range)

        return {
          ok: true,
          move: { from: receipt.to, to: receipt.from },
          planks: {
            from: was
              ? planks.at({ shelf: was.shelf, area: was.area })
              : { areaId: null, label: receipt.to },
            to: planks.at({ shelf: landed.shelf, area: landed.area }),
          },
          /*
           * The book itself is left out for the opposite reason it is left out
           * of a move: there, it is in somebody's hand; here, it never left the
           * shelf, so "carry it back" is not a job. Anything else in this list
           * is a book that really did end up somewhere new, which is a surprise
           * worth reporting.
           */
          moves: (await this.movesSince(range, before)).filter((move) => move.id !== bookId),
        }
      }, { serialiseOn: rangeLock(range) })
    } catch (error) {
      if (error instanceof RetractionRefused) return { ok: false, error: error.message }
      throw error
    }
  }

  /** The moves in this range that have been made and not yet acted on. */
  async outstandingMoves(range: ShelfRange): Promise<OutstandingMove[]> {
    return this.outstanding.inRange(range)
  }

  /**
   * Nothing is outstanding on this book any more.
   *
   * Called when a person says where the book physically is, whatever they say.
   * That closes the gap a move opens from the other end: the catalogue now
   * records an observation somebody made, and there is no longer an assignment
   * sitting there unacted on to take back.
   */
  async clearOutstandingMove(bookId: number): Promise<void> {
    await this.outstanding.clear(bookId)
  }

  /**
   * The area of this range each of these sort keys lands in.
   *
   * The same walk `shelvesForSortKeys` makes, answered as the row rather than as
   * the label: the boundary list that walk steps over is derived from these very
   * areas (`boundariesFrom`), so asking the run directly is one reading of one
   * sequence instead of two that have to agree.
   *
   * Null for every key when the range has no run at all, which is a rule
   * pointing at furniture that has been taken out. That is a fact about the
   * furniture and the review says so out loud rather than quietly judging
   * nothing.
   */
  async areasForSortKeys(range: ShelfRange, sortKeys: string[]): Promise<(number | null)[]> {
    if (!sortKeys.length) return []
    const run = await runAreasOf(this.db, range)
    return sortKeys.map((sortKey) => areaOfKey(run, sortKey)?.id ?? null)
  }

  /** The area one sort key lands in, or null when the run has none to give. */
  async areaForSortKey(range: ShelfRange, sortKey: string): Promise<number | null> {
    return (await this.areasForSortKeys(range, [sortKey]))[0] ?? null
  }

  /**
   * Which books in this range are not where the catalogue says they belong.
   *
   * The two halves of the comparison come from different places on purpose.
   * Where the book is is whatever a person last confirmed, read out of the
   * ledger's projection. Where it belongs is recomputed here from sort order and
   * the areas the run is cut into, so inserting a book earlier in the alphabet,
   * moving a boundary, or editing an author all shift it while the recorded one
   * stays put.
   *
   * **Both halves are area ids** (#356). They used to be labels, and labels are
   * renderings: the ledger renders `Hall shelf · A` for a named piece and the
   * ordinal walk renders `2A` for the same plank, so the comparison could read
   * one side and not the other and set every book on that piece aside.
   *
   * Strictly read only. Detection that quietly rewrote a placement to make the
   * disagreement go away would destroy the record of where the book actually
   * is, which is the one thing the ledger is for.
   *
   * Checked-out books are pulled in explicitly. They are absent from the
   * layout, having no position, and dropping them silently would leave the
   * caller unable to tell "not misfiled" from "not considered".
   */
  async review(range: ShelfRange): Promise<ShelvingReview> {
    const faces = await areaFaces(this.db)
    const placed = await this.layout(range)
    const belongs = await this.areasForSortKeys(
      range,
      placed.map((one) => one.book.sortKey),
    )

    const onShelf = placed.map((one, at) =>
      toFiled(one.book, one.book.area_id, belongs[at] ?? null, faces, false))

    const off = (
      await withPlacements(this.db, await this.db.all<FiledBookRow>(
        // `catalogued_books`, not `books`, and only for the joined filing name:
        // the state is stated here as it always was. See `FiledBookRow`.
        `SELECT * FROM catalogued_books WHERE shelf_range = ? AND state = ?
          ORDER BY sort_key ASC`,
        [range, CHECKED_OUT],
      ))
    ).map((row) => toFiled(row, row.area_id, null, faces, true))

    return reviewShelving([...onShelf, ...off])
  }

  /**
   * Remove a boundary and renumber the rest so positions stay contiguous.
   *
   * The rule and the transaction now live in
   * `application/shelving/remove-separator.ts`, where the prose that used to be
   * here went with them. This stays because `moveAcrossBoundary` below removes
   * boundaries as part of a larger move, and because the route and the tests
   * that already say `shelves.remove(id)` are not what this change is about.
   */
  async remove(id: number): Promise<void> {
    await this.removeSeparator.handle({ separatorId: id })
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
