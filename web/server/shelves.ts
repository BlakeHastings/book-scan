/**
 * Separators, and the derived geography that falls out of them. The arithmetic
 * itself lives in shared/layout.ts and stays pure.
 */

import type { FiledBookRow } from './db.pg'
import type { Db } from './driver'
import { withPhotographs, type FiledPhotographedBook } from './photographs'
import { withPlacements, type PlacementFields } from './placement-ledger'
import {
  areaFaces, bandOf, furnitureIn, planksOf,
  type Plank, type RunPlanks,
} from '../infrastructure/shelving/areas'
import { fixtureLabel } from '../domain/placement/geography'
import { byPrecedence, entryAreaOf, entryAreas } from '../domain/placement/rules'
import { sharedNumberOf, type AreaFace } from '../domain/placement/carry'
import type { LabelChange } from '../domain/placement/arrangement'
import { relabellingWithout } from './furniture'
import {
  areasForSortKeys, recordWhatMoved, whereTheRunPutsThem, type RunAnswer,
} from './what-moved'
import { CHECKED_OUT } from '../domain/books/state'
import { RangeSeparators } from '../domain/shelving/separators'
import {
  RemoveSeparatorHandler, type SeparatorRemoval,
} from '../application/shelving/remove-separator'
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
  type LayoutInput, type Move, type Overflow, type Placed, type Separator,
  type SeparatorKind,
  type ShelfGroup, type Strip,
} from '../shared/layout'
import {
  reviewShelving,
  type AreaStanding, type FiledBook, type ShelfRange, type ShelvingReview,
} from '../shared/shelving'

/**
 * Every transaction that reads a shelf range and then writes to it serialises on
 * this name. Two in flight over one range would each compute a placement from a
 * shelf the other is halfway through changing. See `TxOptions` in driver.ts for
 * why a transaction alone is not enough.
 */
export const rangeLock = (range: ShelfRange): string => `shelf:${range}`

/**
 * A book row plus the camelCase key the pure layout code expects.
 * `FiledPhotographedBook` rather than `BookRow`: every book that reaches the
 * layout arrives with the current photograph of each kind joined onto it, and
 * with what it files under, which the view joins.
 */
export type ShelvedBook = FiledPhotographedBook & PlacementFields & { sortKey: string }

/**
 * `areaId` and `standing` are null together, and only where no piece stands at
 * the board's number at all: a range whose rule points at furniture that has
 * been taken out.
 */
export interface StandingGroup<T extends LayoutInput = LayoutInput> extends ShelfGroup<T> {
  areaId: number | null
  standing: AreaStanding | null
}

/**
 * A row as the misfile check sees it: where it is, and where it belongs. Both
 * sides arrive as an area and a label, and the area is the answer.
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
 * Where a plan takes a book, said both ways at both ends. The label is what
 * somebody reads and the id is what decides: a screen puts the label in front of
 * a person and sends the plank itself back when they say they have carried the
 * book.
 */
export interface Planks {
  from: Plank
  to: Plank
}

/**
 * One direction a boundary move is open in, and what taking it costs. A book
 * alone in an area is both its first and its last book, so both directions are
 * open to it and taking either leaves the area with no books to name, which
 * takes it off the piece. See docs/shelving.md, "The only book in an area".
 */
export interface BoundaryOffer extends Plank {
  /** Null for the ordinary move, which re-anchors a boundary and removes nothing. */
  empties: Emptying | null
}

/**
 * What removing one boundary costs, said to whoever has to agree to it. Not
 * `Emptying`, which is a move whose area has no books left in it by the time it
 * goes; this one is a merge, and the books join the area in front.
 */
export interface AreaGoing {
  area: string
  /** The area its books join: the one drawn above it. */
  into: string
  books: number
  /** Every label that reads differently once it is gone, old to new. */
  becomes: LabelChange[]
}

export interface Emptying {
  /** What each of them is called today, in the order they sit. */
  areas: string[]
  /** Every label that reads differently once they are gone, old to new. */
  becomes: LabelChange[]
}

/**
 * Why a boundary move was refused, said to the person holding the book. `at` is
 * the plank named the way the book's own page names it, not the way the layout
 * numbers it.
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
 * back with it: a refusal here has to undo the part of the restore that already
 * ran, which a returned value cannot do from inside the transaction. Caught at
 * the one place it is thrown from and turned back into the same
 * `{ ok: false, error }` every other refusal in this file returns.
 */
class RetractionRefused extends Error {}

/**
 * Thrown when the act refused to take an area off the furniture.
 * `moveAcrossBoundary` reaches that act after the receipt and the re-anchoring
 * are written, so the throw is what takes them back out: the savepoint rolls
 * back and the outer transaction rolls back with it. Caught outside the
 * transaction, the way `RetractionRefused` is.
 */
class AreaRemovalRefused extends Error {
  constructor(readonly areaIds: readonly number[]) {
    super('An area would come off the furniture and nobody has been asked.')
  }
}

/**
 * Thrown when the act itself would not take the area, whatever anybody agreed
 * to. A different answer from `AreaRemovalRefused` and it has to stay different:
 * that one is a question the person has not been asked yet, this one is a
 * sentence about the furniture that asking would not change.
 */
class AreaRemovalImpossible extends Error {
  constructor(readonly said: string) {
    super(said)
  }
}

const SHELVES_MOVED_ON =
  'The shelves have changed since that move, so it cannot be taken back ' +
  'without moving something else. Say where the book actually is instead.'

/**
 * What a move is about to change, said as what it would take to change it back.
 * Built from the boundaries and the planks as they stand before the move, which
 * is the only moment the answer exists: afterwards the shifted boundaries carry
 * their new anchor, the removed ones carry nothing, and the plank the move
 * empties is off the face. The area ids survive that and the labels do not.
 */
function receiptFor(
  range: ShelfRange,
  bookId: number,
  move: BoundaryMove,
  planks: Planks,
  before: Separator[],
  now: string,
): OutstandingMove {
  const was = new Map(before.map((one) => [one.id, one]))

  return {
    bookId,
    range,
    from: move.from,
    to: move.to,
    fromArea: planks.from.areaId,
    toArea: planks.to.areaId,
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
 * Order is the shelving logic: every layout comes from a read taken before the
 * write it is compared against, and every sort happens on the rows that read
 * returned. Separators have no SQL in this file, going through
 * `SeparatorRepository`, and the removal through a command handler in
 * `application/`.
 */
export class Shelves {
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
   * Which plank a range begins on, or null when no rule says. Null is the answer
   * and not a hole to fill: every reader below asks and stops when it comes
   * back, because a range with no rule has no run to lay books out along, no
   * plank to name and no gap to point at.
   */
  private async startOf(range: ShelfRange): Promise<RangeStart | null> {
    return (await bandOf(this.db, range))?.start ?? null
  }

  /**
   * The same answer said for a person: what the plank this range opens at is
   * called, or null when no rule says where the range begins. Not a label to put
   * a book on, which is `areaForSortKey` and then `RunPlanks.labelOf`.
   */
  async beginsAt(range: ShelfRange): Promise<string | null> {
    const start = await this.startOf(range)
    return start === null ? null : (await this.planks(range)).at(start).label
  }

  /**
   * The books on a shelf in this range, in order. Every layout, every strip,
   * every boundary decision and the misfile review are drawn from this one
   * statement, which is why it reads `shelved_books` and not `books`: a
   * checked-out book holds no position and is absent, and the view's predicate
   * is the only place that condition is written.
   */
  private async booksIn(
    range: ShelfRange,
    excludeId = 0,
  ): Promise<(FiledPhotographedBook & PlacementFields)[]> {
    // The photographs and the placements are joined on here, one statement each
    // for the whole range. Asking per book would be two statements per book on
    // the path that draws the library.
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

  /**
   * Every book in a range, with the shelf it lands on. Empty when no rule says
   * where the range begins, which is not the same silence as no books: a caller
   * drawing this for a person tells the two apart by the `begins` that `shelving`
   * hands back beside the boards.
   */
  async layout(range: ShelfRange): Promise<Placed<ShelvedBook>[]> {
    const start = await this.startOf(range)
    if (!start) return []
    return layoutRange(
      (await this.booksIn(range)).map((row) => ({ ...row, sortKey: row.sort_key })),
      await this.list(range),
      start,
    )
  }

  /**
   * The run drawn as boards, each joined back to the plank of furniture it is
   * drawn on. The join is from the address, not from the books standing there:
   * where a book happens to stand is the ledger's answer, and the two
   * disagreeing is a misfile rather than a board's identity.
   */
  async groups(range: ShelfRange): Promise<StandingGroup<ShelvedBook>[]> {
    const separators = await this.list(range)
    return this.standing(
      await this.planks(range),
      groupByShelf(await this.layout(range), separators),
      separators,
    )
  }

  /**
   * The run's planks, said as the furniture they are, with what stands on each.
   * The run is the furniture's list and not the books': `groupByShelf` emits a
   * board per run of books and therefore none at all for a plank nothing is
   * standing on. A boundary is paired to its plank by identity rather than by an
   * anchor, because a separator's id is the id of the area it opens
   * (`boundariesFrom`), and there is no fallback to `groupByShelf`'s own list:
   * `planks.every()` is empty exactly when the layout is.
   */
  private standing<T extends LayoutInput>(
    planks: RunPlanks,
    groups: ShelfGroup<T>[],
    separators: readonly Separator[],
  ): StandingGroup<T>[] {
    const address = (where: PlankAt) => `${where.shelf}:${where.area}`
    const standingThere = new Map(groups.map((group) => [address(group), group]))
    const opens = new Map(separators.map((separator) => [separator.id, separator]))

    const boards = planks.every().map((where) => standingThere.get(address(where))
      ?? { ...where, label: '', books: [] as Placed<T>[], opensWith: null })

    return boards.map((group) => {
      const where = { shelf: group.shelf, area: group.area }
      const plank = planks.at(where)
      const opener = plank.areaId === null ? undefined : opens.get(plank.areaId)
      return {
        ...group,
        label: plank.label,
        areaId: plank.areaId,
        standing: planks.standingAt(where),
        opensWith: opener ? { id: opener.id, kind: opener.kind } : null,
      }
    })
  }

  async loads(range: ShelfRange) {
    return shelfLoads(await this.layout(range), await this.list(range))
  }

  /**
   * The whole run drawn once: the boundaries, the shelves and what is on each.
   * `groups` and `loads` are the same picture counted two ways, answered off one
   * snapshot so that a book saved between two reads cannot appear on a shelf
   * whose count excludes it.
   */
  async shelving(range: ShelfRange): Promise<{
    groups: StandingGroup<ShelvedBook>[]
    separators: Separator[]
    loads: { label: string; count: number }[]
    /*
     * Handed back rather than read again by the route, which also has to name
     * the plank each checked-out book would go back on.
     */
    planks: RunPlanks
    /**
     * What the plank this run opens at is called, or null when no rule says
     * where the range begins. Handed back because an empty `groups` has two
     * causes and a screen drawing one of them has to know which: a range with
     * nothing catalogued in it, and a range nothing says the whereabouts of.
     */
    begins: string | null
  }> {
    const separators = await this.list(range)
    const start = await this.startOf(range)
    const planks = await this.planks(range)
    const placed = start === null
      ? []
      : layoutRange(
        (await this.booksIn(range)).map((row) => ({ ...row, sortKey: row.sort_key })),
        separators,
        start,
      )
    const groups = this.standing(planks, groupByShelf(placed, separators), separators)
    // `shelfLoads` is `groupByShelf` and a count, so the count is taken off the
    // groups already in hand rather than by grouping the same layout again.
    return {
      groups,
      separators,
      loads: groups.map((group) => ({ label: group.label, count: group.books.length })),
      planks,
      begins: start === null ? null : planks.at(start).label,
    }
  }

  /**
   * Which shelf a book with this sort key would land on. Works for a book that
   * is not saved yet, which is the case that matters: the shelving step has to
   * name a real shelf before the book exists.
   */
  async shelfForSortKey(range: ShelfRange, sortKey: string): Promise<string> {
    return (await this.shelvesForSortKeys(range, [sortKey]))[0]!
  }

  /**
   * The same question asked about many keys at once, which is one read rather
   * than one read each. Where a key lands is decided by the boundaries it has
   * passed and by where the range begins, and by nothing about the other books,
   * so laying a hundred keys out together answers each one exactly as laying it
   * out among the whole range would.
   */
  async shelvesForSortKeys(range: ShelfRange, sortKeys: string[]): Promise<string[]> {
    if (!sortKeys.length) return []

    const labels = new Array<string>(sortKeys.length).fill('')

    // Every key comes back empty when no rule says where the range begins, which
    // is what this already answers for a key it could not place.
    const start = await this.startOf(range)
    if (!start) return labels

    // `layoutRange` requires sort order, so the keys are ordered and put back
    // afterwards by the position each one arrived in.
    const ordered = sortKeys
      .map((sortKey, at) => ({ id: at, sortKey }))
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))

    const placed = layoutRange(ordered, await this.list(range), start)

    for (const one of placed) labels[one.book.id] = one.label
    return labels
  }

  /**
   * The run laid out as though a book with this sort key were already in it. The
   * rows are read first and the newcomer merged into the array that read
   * returned, so the sort runs over one consistent snapshot of the range. Empty
   * when no rule says where the range begins.
   */
  private async layoutWith(
    range: ShelfRange,
    sortKey: string,
    excludeId = 0,
  ): Promise<Placed<ShelvedBook>[]> {
    const start = await this.startOf(range)
    if (!start) return []
    const books = (await this.booksIn(range, excludeId))
      .map((row) => ({ ...row, sortKey: row.sort_key }))
    const merged = [...books, { id: NEWCOMER_ID, sortKey } as ShelvedBook]
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    return layoutRange(merged, await this.list(range), start)
  }

  /**
   * Everything standing on one plank right now, in the order it stands there.
   * Not the layout: that answers where a book belongs, which is a question about
   * the rules, and this answers what is on the plank, including books the rules
   * have no opinion about. Reads `current_area_id`, the projection of the
   * ledger's `placed` rows, which is the same reading `tripAtArea` makes at the
   * other end of the walk.
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

  async strip(
    range: ShelfRange,
    sortKey: string,
    excludeId = 0,
  ): Promise<Strip<ShelvedBook> | null> {
    return stripAround(await this.layoutWith(range, sortKey, excludeId))
  }

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
   * `labelFor` above says what to call the place; this says which place it is,
   * which is what a write needs.
   */
  async areaOf(range: ShelfRange, bookId: number): Promise<number | null> {
    const on = (await this.layout(range)).find((p) => p.book.id === bookId)
    if (!on) return null
    return (await this.planks(range)).at({ shelf: on.shelf, area: on.area }).areaId
  }

  async planks(range: ShelfRange): Promise<RunPlanks> {
    return planksOf(this.db, range)
  }

  /**
   * The address the layout gives the plank an id names, or null when this run
   * has no such plank. The one place an area id becomes the pair of ordinals
   * shared/layout.ts addresses a plank by, and deliberately the only one: a
   * second would be a second opinion about which plank a button meant. Null is a
   * refusal and not a fallback, because moving a real book on a guess is the
   * hazard here.
   */
  async addressOf(range: ShelfRange, areaId: number): Promise<PlankAt | null> {
    return (await this.planks(range)).addressOf(areaId)
  }

  /**
   * What saying "this shelf will not take another book" would do. Read only. The
   * end-of-shelf case is tried first: there the book in hand is the one that
   * moves and nothing already shelved is touched, and `placing` is its sort key,
   * which is what makes that case visible at all, because the book does not
   * exist yet and is absent from every layout the database can produce.
   * Otherwise the last book comes off the end, and whether the next shelf can
   * cope is the next question the caller asks.
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
    // plank.
    const label = locationLabel(at.shelf, at.area)
    const before = await this.layout(range)
    const separators = await this.list(range)

    /*
     * Before the cascade, and before the label is checked against the shelves
     * that exist: a book being placed can be about to go on a plank a boundary
     * move left bare, which has no books to name it and so is absent from the
     * groups below.
     */
    if (placing) {
      const carry = carryOn(
        await this.layoutWith(range, placing), separators, label, kindIfNew,
      )
      if (carry) {
        const off = await this.offTheRun(range, carry.toAt)
        return off ? { ok: false, error: off } : { ok: true, carry, before, separators }
      }
    }

    const groups = groupByShelf(before, separators)
    const planks = await this.planks(range)
    // Named for a person: a bookcase somebody has named reads by that name
    // everywhere else on the same screen.
    const here = planks.at(at).label || label

    /*
     * The sentence names the shelves this run does have, because a label that
     * never existed and a shelf that is full are different failures and one
     * message for both sends somebody looking at the wrong thing.
     */
    const noSuchPlank = () => {
      const said = groups.map((g) => planks.at({ shelf: g.shelf, area: g.area }).label)
      return said.length
        ? `There is no shelf ${here}. Shelves here are ${said.join(', ')}.`
        : `There is no shelf ${here} yet; nothing has been shelved in this range.`
    }

    // `overflow` answers null for exactly this, and asking it that way keeps the
    // two from being able to disagree about which planks a run has.
    const step = overflow(before, separators, label, kindIfNew)
    if (!step) return { ok: false, error: noSuchPlank() }

    const off = await this.offTheRun(range, step.toAt)
    if (off) return { ok: false, error: off }

    return { ok: true, step, before, separators }
  }

  /**
   * Why this run may not step onto that plank, or the empty string. A run stops
   * where the next run begins and a bookcase holds one run, so the bound is
   * `bandOf`, the same cut `runFrom` and `relocateRun` make. It is `band.end`
   * and not `band.limit`: this asks where the run stops, and a run stops at a
   * plank. See docs/shelving.md.
   */
  private async offTheRun(range: ShelfRange, to: PlankAt): Promise<string> {
    const band = await bandOf(this.db, range)
    const past = band?.end
    if (!past) return ''
    if (to.shelf < past.shelf || (to.shelf === past.shelf && to.area < past.area)) return ''

    const { order, rules } = await furnitureIn(this.db)
    const entries = entryAreas(rules, order)
    const standing = order.find((slot) =>
      slot.fixture.position === past.shelf && slot.area.position === past.area
      && entries.has(slot.area.id))
    const piece = standing ? fixtureLabel(standing.fixture) : String(past.shelf)
    /*
     * More than one rule can open one plank, so the rule named here is the one
     * `byPrecedence` puts first, which is the ladder the app decides by. `find`
     * over the rows would name whichever the database handed back.
     */
    const held = standing
      ? [...rules].sort(byPrecedence)
        .find((rule) => entryAreaOf(rule, order) === standing.area.id)?.name ?? ''
      : ''

    return `There is no room for another bookcase here. Bookcase ${piece} is where `
      + `${held || 'another rule'} begins, and a bookcase holds one run. Renumber that `
      + 'bookcase further along, which moves no books and only changes what its planks '
      + 'are called, and then say there is no room again.'
  }

  /**
   * The move a full shelf would need, offered rather than made. Nothing here
   * writes: a proposal is not an observation, and until somebody has actually
   * carried the book there is nothing to record. The strip is computed against
   * the separators the move would produce, held in memory and never saved, so the
   * picture describes the thing being confirmed without making it true.
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
    /*
     * Null start is unreachable from here and is answered anyway: `planOverflow`
     * above walks the run and refuses before this line when there is none.
     */
    const start = await this.startOf(range)
    const after = start === null
      ? []
      : layoutRange(books, this.separatorsAfter(plan.separators, step), start)

    return {
      ok: true,
      step,
      strip: stripWithGap(after, step.moved.id),
      planks: await this.naming(range, step),
    }
  }

  /**
   * A plan's two planks, joined back to the furniture. Read after the plan
   * rather than before, so a plank the plan has just made comes back with the id
   * it was given.
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
   * The person says they have carried the book, so the shelves change. The plan
   * is recomputed here rather than carried over from whatever was proposed a
   * moment ago, and `expectId` is the book the person was told to move: a
   * mismatch is refused rather than quietly applied to a different one. The
   * carry is applied without any of that, because nothing already shelved moves.
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
    planks?: Planks
  }> {
    /*
     * Plan, check and apply are one unit. `expectId` above is an
     * optimistic-concurrency check, and outside a transaction it does not close
     * the window it names: two people confirming there is no room on the same
     * shelf both pass it, and one separator gets shifted twice or two land at
     * the same position. Reading and writing the same range takes turns, so see
     * `rangeLock`.
     */
    return this.db.tx(async () => {
      const plan = await this.planOverflow(range, at, kindIfNew, placing)
      if (!plan.ok) return { ok: false, error: plan.error }

      if (plan.carry) {
        await this.applyBoundary(range, plan.carry, `${plan.carry.from} was full`)
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

      await this.applyBoundary(range, step, `${step.from} was full`)

      return {
        ok: true,
        step,
        moves: await this.movesSince(range, plan.before),
        // After the write, so a plank this step has just made comes back with
        // the id it was given.
        planks: await this.naming(range, step),
      }
    }, { serialiseOn: rangeLock(range) })
  }

  /**
   * Write the one boundary change a plan asks for. The recording is part of the
   * write and not a step beside it, so both answers this method serves get it
   * without either caller having a step to remember. See `recordWhatMoved`.
   */
  private async applyBoundary(
    range: ShelfRange,
    plan: { create?: { startsAt: string; kind: SeparatorKind }; shift?: { id: number; startsAt: string } },
    reason: string,
  ): Promise<void> {
    const before = await this.whereTheRunPutsThem(range)

    if (plan.create) {
      // Counted before the insert: the new separator takes the position after
      // the ones already there.
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

    await this.recordWhatMoved(range, before, reason, new Date().toISOString())
  }

  /**
   * The first or last book of an area, carried to the plank next door. Nothing
   * here writes a location: where a book physically is was observed by a person
   * and is written through PATCH /api/books/:id/location, and what changes here
   * is an area boundary, re-anchored one book along. Moving the only book off a
   * plank leaves the area with no books to name, so the move takes the area off
   * the piece; `told` is that assent, and it is carried down to the act that
   * removes the boundary rather than checked here.
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
    planks?: Planks
    /** What the refused move would have taken off the furniture. */
    empties?: Emptying | null
  }> {
    /*
     * The read that decides the move is inside the transaction with the writes
     * it decides: a concurrent overflow landing between the layout read and the
     * first write would anchor a boundary from a layout that no longer exists.
     * `remove` opens a transaction of its own and is called from inside this
     * one, which is the nesting `Db.tx` handles with a savepoint.
     */
    try {
      return await this.movedAcrossBoundary(range, bookId, direction, told)
    } catch (caught) {
      // The act's own sentence, passed on rather than reworded.
      if (caught instanceof AreaRemovalImpossible) {
        return { ok: false, error: `${caught.said} Nothing has been changed.` }
      }
      if (!(caught instanceof AreaRemovalRefused)) throw caught
      /*
       * The act refused, so the whole transaction above went back and the
       * areas are where they were. That is what makes it safe to read them
       * again here to say which ones the move would have taken.
       */
      const going = await this.emptyingOf(range, caught.areaIds)
      return {
        ok: false,
        error: `${going!.areas.join(' and ')} would have no books left on it, so `
          + 'moving this one takes it off the furniture. Nothing has been changed.',
        empties: going,
      }
    }
  }

  /** `moveAcrossBoundary`'s transaction, so the refusal above can catch. */
  private async movedAcrossBoundary(
    range: ShelfRange,
    bookId: number,
    direction: BoundaryDirection,
    told: { theAreaGoes: boolean },
  ): Promise<{
    ok: boolean
    error?: string
    move?: BoundaryMove
    moves?: Move[]
    planks?: Planks
    empties?: Emptying | null
  }> {
    return this.db.tx(async () => {
      const before = await this.layout(range)
      const boundaries = await this.list(range)
      const outcome = boundaryMove(before, boundaries, bookId, direction)

      if (!outcome.ok) {
        // The plank the sentence is about, named the way the book's own page
        // names it.
        const said = outcome.atAt
          ? (await this.planks(range)).at(outcome.atAt).label || outcome.at
          : outcome.at
        return { ok: false, error: refusal(outcome.reason, said, direction) }
      }

      /*
       * Written before the change, because it is a record of what the change is
       * about to undo: reading the boundaries afterwards would give their new
       * anchors, and reading them for a removal would give nothing at all. The
       * two planks are read here for the same reason, since the one the move
       * empties is off the face afterwards while its area id still names the row.
       */
      const now = new Date().toISOString()
      const between = await this.naming(range, outcome.move)
      await this.outstanding.record(
        receiptFor(range, bookId, outcome.move, between, boundaries, now),
        now,
      )

      /*
       * And the run's answer as it stands, for the same reason and a different
       * record. The receipt says how to put the furniture back, names no area,
       * and nothing that counts work reads it. Both facts are true of a move, so
       * a move writes both.
       */
      const wanted = await this.whereTheRunPutsThem(range)

      // The whole set at once. A move that empties an area re-anchors two
      // boundaries sharing one anchor, and where a boundary sits in the run is
      // decided by its anchor, so applying them one at a time leaves the second
      // with nothing to do. See `reanchorAll`.
      await this.separators.reanchorAll(outcome.move.shift)
      for (const id of outcome.move.remove) {
        /*
         * The assent goes to the act rather than being spent here, and the
         * throw is what takes the receipt and the re-anchoring above back out
         * with it.
         */
        const removal = await this.remove(id, told)
        if (!removal.ok) {
          if (removal.reason === 'refused') throw new AreaRemovalImpossible(removal.error)
          throw new AreaRemovalRefused(outcome.move.remove)
        }
      }

      /*
       * After the removals, so a move that empties an area is recorded once:
       * `dropArea` has already written an assignment for the books that named
       * the plank it took off, so this adds a row only for a book the removal
       * was not about.
       */
      await this.recordWhatMoved(
        range,
        wanted,
        `a book crossed the boundary from ${outcome.move.from} to ${outcome.move.to}`,
        now,
      )

      return {
        ok: true,
        move: outcome.move,
        /*
         * The moved book is deliberately absent: it is in somebody's hand, and
         * where it landed is recorded through the location route rather than
         * handed back as a job still to do.
         */
        moves: (await this.movesSince(range, before)).filter((move) => move.id !== bookId),
        /*
         * Read after the boundaries moved, which is what the person is about to
         * act on. Both planks exist either side of a boundary move, since it
         * refuses at the ends of the run rather than making furniture, so
         * neither id here is ever null.
         */
        planks: await this.naming(range, outcome.move),
      }
    }, { serialiseOn: rangeLock(range) })
  }

  /**
   * Which plank a boundary move would land this book on, in each direction,
   * without moving anything. A courtesy for the screen and not the rule itself:
   * the write path checks again regardless, because a shelf can change between
   * the two calls. The cost comes with the offer because either direction of a
   * book alone in an area takes that area off the piece, and a screen cannot ask
   * about what the offer does not mention.
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
   * The areas a move takes off the furniture, or null when it takes none. Read
   * off `move.remove`, the boundary list the write path is about to delete, and
   * a boundary's id is the area it opens (`boundariesFrom`), so the question and
   * the answer are the same rows.
   */
  private async emptying(
    range: ShelfRange,
    move: BoundaryMove,
    known?: RunPlanks,
  ): Promise<Emptying | null> {
    return this.emptyingOf(range, move.remove, known)
  }

  /**
   * The same answer asked about the boundary ids on their own, because
   * `moveAcrossBoundary`'s refusal is caught after its transaction has rolled
   * back and the `BoundaryMove` that planned the removal is out of scope by
   * then. The ids are what survive it.
   */
  private async emptyingOf(
    range: ShelfRange,
    areaIds: readonly number[],
    known?: RunPlanks,
  ): Promise<Emptying | null> {
    if (areaIds.length === 0) return null
    const planks = known ?? await this.planks(range)
    return {
      areas: areaIds.map((id) => planks.labelOf(id)).filter(Boolean),
      becomes: await relabellingWithout(this.db, areaIds),
    }
  }

  /**
   * What removing this boundary takes off the run, before anybody agrees to it.
   * Writes nothing. Read off `groups`, the same picture the shelves screen
   * draws. The fallbacks below are for a separator id that names no plank of
   * this run at all, which is possible from a screen drawn before somebody
   * else's removal landed, and `into` is empty only for the first board of a
   * run, which opens with no boundary.
   */
  async removalCost(range: ShelfRange, separatorId: number): Promise<AreaGoing> {
    const groups = await this.groups(range)
    const at = groups.findIndex((group) => group.opensWith?.id === separatorId)
    return {
      area: at < 0 ? (await this.planks(range)).labelOf(separatorId) : groups[at]!.label,
      into: at < 1 ? '' : groups[at - 1]!.label,
      books: at < 0 ? 0 : groups[at]!.books.length,
      becomes: await relabellingWithout(this.db, [separatorId]),
    }
  }

  /**
   * Take back a move nobody acted on, and put the boundaries where they were.
   * Nothing here writes a location: the book never left the plank the catalogue
   * records it on, so there is nothing about the room to write down. "Back"
   * means where the boundaries were rather than where the rules would put them
   * now, because after a move that emptied an area two boundaries sit on one
   * anchor and the opposite move would carry the book two planks; so the undo is
   * replayed from the receipt and then checked, and rolls back if the book does
   * not land on the plank the catalogue records.
   */
  async retractMove(
    range: ShelfRange,
    bookId: number,
  ): Promise<{
    ok: boolean
    error?: string
    move?: { from: string; to: string }
    moves?: Move[]
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
        /*
         * The run's answer before the boundaries go back, so what this undo
         * moves can be told from what it left alone. See `recordWhatMoved`.
         */
        const wanted = await this.whereTheRunPutsThem(range)

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
        await this.recordWhatMoved(
          range, wanted, 'the move was taken back', new Date().toISOString(),
        )

        /*
         * Both planks read off the layout rather than out of the receipt: the
         * receipt holds two ordinals written when the move was made, and the
         * piece may have been named since.
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
           * The book itself is left out because it never left the shelf, so
           * "carry it back" is not a job. Anything else in this list really did
           * end up somewhere new.
           */
          moves: (await this.movesSince(range, before)).filter((move) => move.id !== bookId),
        }
      }, { serialiseOn: rangeLock(range) })
    } catch (error) {
      if (error instanceof RetractionRefused) return { ok: false, error: error.message }
      throw error
    }
  }

  /** See `what-moved.ts` for why the answer is ids and not labels. */
  private async whereTheRunPutsThem(range: ShelfRange): Promise<Map<number, RunAnswer>> {
    return whereTheRunPutsThem(this.db, range)
  }

  /**
   * Write down where the books a boundary write moved now belong. The reasoning,
   * and the function, are in `what-moved.ts`.
   */
  private async recordWhatMoved(
    range: ShelfRange,
    before: ReadonlyMap<number, RunAnswer>,
    reason: string,
    now: string,
  ): Promise<void> {
    await recordWhatMoved(this.db, range, before, reason, now)
  }

  async outstandingMoves(range: ShelfRange): Promise<OutstandingMove[]> {
    return this.outstanding.inRange(range)
  }

  /**
   * Nothing is outstanding on this book any more. Called when a person says
   * where the book physically is, whatever they say: the catalogue then records
   * an observation somebody made, so there is no assignment left to take back.
   */
  async clearOutstandingMove(bookId: number): Promise<void> {
    await this.outstanding.clear(bookId)
  }

  async areasForSortKeys(range: ShelfRange, sortKeys: string[]): Promise<(number | null)[]> {
    return areasForSortKeys(this.db, range, sortKeys)
  }

  /** The area one sort key lands in, or null when the run has none to give. */
  async areaForSortKey(range: ShelfRange, sortKey: string): Promise<number | null> {
    return (await this.areasForSortKeys(range, [sortKey]))[0] ?? null
  }

  /**
   * Which books in this range are not where the catalogue says they belong.
   * Both halves are area ids and not labels, which are renderings: where the
   * book is is whatever a person last confirmed, read out of the ledger's
   * projection, and where it belongs is recomputed here from sort order and the
   * areas the run is cut into. Strictly read only, because rewriting a placement
   * to make the disagreement go away would destroy the record of where the book
   * actually is. Checked-out books are pulled in explicitly, having no position
   * and so being absent from the layout.
   */
  async review(range: ShelfRange): Promise<ShelvingReview> {
    const faces = await areaFaces(this.db)
    /*
     * The books, not the layout: where the book is comes off the ledger's
     * projection on the row and where it belongs comes off `areasForSortKeys`,
     * which walks the run directly. `layout` is empty for a range no rule
     * claims, so reading it here would silently take every book of that range
     * off the one list that says a book is not where it belongs;
     * `areasForSortKeys` answers null for every key instead, which is
     * `unplaceable`.
     */
    const books = (await this.booksIn(range))
      .map((row) => ({ ...row, sortKey: row.sort_key }))
    const belongs = await this.areasForSortKeys(range, books.map((one) => one.sortKey))

    const onShelf = books.map((book, at) =>
      toFiled(book, book.area_id, belongs[at] ?? null, faces, false))

    const off = (
      await withPlacements(this.db, await this.db.all<FiledBookRow>(
        // `catalogued_books`, not `books`, for the joined filing name; the state
        // is stated here. See `FiledBookRow`.
        `SELECT * FROM catalogued_books WHERE shelf_range = ? AND state = ?
          ORDER BY sort_key ASC`,
        [range, CHECKED_OUT],
      ))
    ).map((row) => toFiled(row, row.area_id, null, faces, true))

    const review = reviewShelving([...onShelf, ...off])

    /*
     * A row reading "last seen on 1B, now puts it on 1B" is two planks wearing
     * one letter, which is legal because `fixture.position` is not unique.
     * `sharedNumberOf` is the one reading of it, so a note on one screen and
     * silence on the other is not a thing this can drift into.
     */
    return {
      ...review,
      misfiles: review.misfiles.map((misfile) => {
        const ends = {
          from: misfile.book.areaId === null ? undefined : faces.get(misfile.book.areaId),
          to: faces.get(misfile.toAreaId),
        }
        return {
          ...misfile,
          sharedNumber: ends.from && ends.to ? sharedNumberOf(ends.from, ends.to) : null,
        }
      }),
    }
  }

  /**
   * Take the area a boundary opens off the furniture. The rule and the
   * transaction live in `application/shelving/remove-separator.ts`, and this is
   * the same act as `DELETE /api/areas/:id` through the same function. `told` is
   * not defaulted to yes and must not become so: every door to this act is
   * refused until somebody has been asked, and a caller that says nothing is a
   * caller nobody asked.
   */
  async remove(
    id: number,
    told: { theAreaGoes: boolean } = { theAreaGoes: false },
  ): Promise<SeparatorRemoval> {
    return this.removeSeparator.handle({ separatorId: id, theAreaGoes: told.theAreaGoes })
  }

  /**
   * What physically has to move if this run of books becomes the new one. Called
   * with the layout captured before a change.
   */
  async movesSince(range: ShelfRange, before: Placed<ShelvedBook>[]): Promise<Move[]> {
    return diffLayout(before, await this.layout(range))
  }
}
