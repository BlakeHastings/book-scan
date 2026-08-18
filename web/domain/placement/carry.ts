/**
 * The work that is outstanding, as the trips somebody would walk to do it.
 *
 * **This is not a second work list.** `assigned` disagreeing with `placed` is
 * the list, and it is a property of the ledger rather than a computation beside
 * it (`needsAttention`, `domain/placement/ledger.ts`). What this file adds is
 * the shape a person can act on: the same disagreement, grouped and ordered the
 * way somebody with a phone in one hand and books in the other would work
 * through it.
 *
 * ## There is no plan, so there is nothing to go stale
 *
 * Nothing here is stored and nothing here writes. The work is recomputed every
 * time the list is drawn, so a rule changed five minutes ago is already in the
 * answer. The one thing that must not be re-answered underneath somebody is the
 * screen naming an area for the book in their hand, and that is the client's
 * job: it takes an armful and stops asking.
 *
 * ## The unit is a trip, not a book
 *
 * A trip is everything coming off one area and going onto one other. Fifty
 * books in book order is fifty walks; "22 books, 4C to 3C" is one. That is the
 * same group `plan.ts` answers a proposal with, and it is the same group for
 * the same reason: the model was already grouping the answer the way the body
 * does the work.
 *
 * ## Grouped by where the books come off, biggest piece first
 *
 * Both groupings cost the same number of walks, so the walks do not decide it.
 * Taking a book off means finding it among the ones that are staying, which is
 * reading spines; putting it down does not. So an area should be read once and
 * everything leaving it pulled at once, which is what grouping by `from` gives.
 *
 * Between pieces, the one with most to come off it goes first, because emptying
 * a piece completely is the win. Within a piece the order is the order the areas
 * stand in, which is the closest thing to a path across a room.
 *
 * ## Leaving books where they are takes work off this list and not off the app
 *
 * Somebody who is not going to walk a trip can say so, and the books leave the
 * trips because the disagreement behind them is gone (`released`,
 * `domain/placement/ledger.ts`). **They do not leave the screen.** The rule that
 * asked is still on that place, and it is the person's to change or to keep, so
 * the pair and the count and the rule's name stay on the list as `setAside`.
 * A list that silently forgot forty-six books somebody had decided about would
 * be as bad as one that silently asked for them again.
 *
 * ## A book in transit gets no row, and this file is why that costs nothing
 *
 * Nothing is recorded between lifting a book off one area and putting it on
 * another, so a book being carried is still on the list until it is down. That
 * is the honest answer: the last thing anybody said about it is still the last
 * thing anybody saw. It also means an abandoned armful leaves nothing to unwind.
 *
 * ## What "already carried" is read off, since nothing records a session
 *
 * A carry the app asked for leaves a shape in the ledger: an `assigned` row
 * naming an area, and then a `placed` row landing in it. `lastCarry` finds that
 * pair, which is how a resumed list can say what was done on Sunday and how a
 * trip can say that seven of its eighteen are already at the other end, without
 * anything having been stored per session.
 */

import { needsAttention, standingOf, type Placement } from './ledger'

/**
 * Where one area reads and where it stands, which is all this file needs of the
 * furniture.
 *
 * Not `Slot`, and that is the whole reason this is its own shape. A book can be
 * recorded on a plank the collection has since taken out, which is exactly what
 * moving a run does to the bookcase it leaves, and a retired area is off every
 * arrangement there is. The person is still standing in front of `4A`, so `4A`
 * is what a trip has to say, and the caller reads these back with the same
 * `faceOf` the wire uses rather than from the furniture as it stands.
 */
export interface AreaFace {
  /** The label as it reads off the furniture. */
  label: string
  fixtureId: number
  /** The fixture's ordinal, for ordering the pieces against each other. */
  fixturePosition: number
  /** The area's ordinal on its piece, for walking a piece in order. */
  areaPosition: number
}

/**
 * The two pictures a book is drawn by, whichever way up it is drawn.
 *
 * **A name is not enough to recognise a book at a shelf**, which is the whole
 * job of these screens: somebody is standing in front of eleven spines looking
 * for eight, and the picture is what they match the phone against. Every other
 * list in the app draws them, so a book that arrives here without them is drawn
 * as a coloured block and the row stops reading as books.
 *
 * Filenames, and empty for a book nobody has photographed, which is a real book
 * rather than an error: the cloth behind the picture is what such a book is
 * drawn in, and it is drawn in it on every other screen too.
 *
 * **Chosen before they get here.** Which photograph stands in for a spine and
 * which for a cover is `shared/shelving.ts`'s to answer and nothing else's, so
 * these arrive already decided rather than as seven filenames for this file to
 * have an opinion about.
 */
export interface BookPictures {
  /** The book standing up, which is the spine, or what stands in for one. */
  spine: string
  /** The book lying face up, for a row or a tile. */
  cover: string
}

/**
 * What the carry list needs to know about a book, which is what a row shows.
 *
 * No sort key, and that is not an oversight: nothing here re-orders books
 * against each other. They arrive in the order they stand on the shelves and
 * they stay in it, so a trip's books read down the area the way somebody pulling
 * them reads the spines.
 */
export interface CarryableBook extends BookPictures {
  id: number
  title: string
  authorFiling: string
}

/** A book as this list names it: enough to recognise it holding the shelf. */
export interface CarriedBook extends BookPictures {
  id: number
  title: string
  authorFiling: string
}

/**
 * Everything coming off one area for one other, which is one armful and one
 * walk.
 */
export interface CarryTrip {
  fromAreaId: number
  toAreaId: number
  /** Where the books are now, as the label reads off the furniture. */
  from: string
  /** Where they are going. */
  to: string
  /** The books still to carry, in the order they stand on the area. */
  books: CarriedBook[]
  /**
   * How many of this trip's books are already at the other end.
   *
   * Not a number the list needs to add up: those books have left it. It is here
   * so a resumed trip reads as carrying on rather than as starting, which is the
   * normal case rather than the exception.
   */
  carried: number
}

/**
 * Why a book is not on the list, in the words and the order the plan uses.
 *
 * A list of fifty-three that had quietly dropped three pinned books would be
 * believed, so every one of these is counted and named.
 */
export const CARRY_SKIPS = ['pinned', 'checked-out', 'withdrawn', 'never-placed'] as const

export type CarrySkip = (typeof CARRY_SKIPS)[number]

export interface CarrySkipped {
  reason: CarrySkip
  books: number
}

/** What was carried, and when, so a resumed list can lead with it. */
export interface CarriedAlready {
  /** Books carried on the most recent day anybody carried one. */
  books: number
  /** That day, as a date. Empty when nobody has ever carried anything. */
  when: string
}

/**
 * What the newest run of the rules did to the list.
 *
 * Two different things, and the second is the one that stings. Books that no
 * longer need moving simply leave and a count is enough. Books somebody
 * **already carried** that need carrying again cannot be left to be discovered
 * one at a time at a shelf, so they are named with both ends of the new carry.
 */
export interface CarryChange {
  /** Books the run took off the list, because it wants them where they are. */
  left: number
  /** Books the run put on it. */
  joined: number
  /** Of those, the ones somebody had already carried once. */
  again: { book: CarriedBook; from: string; to: string }[]
}

/**
 * A trip somebody decided not to walk, still named on the list.
 *
 * **A book left where it stands leaves the trips and does not leave the
 * screen.** The whole of the disagreement is gone from the ledger, so nothing
 * would draw these at all, and a list that quietly forgot forty-six books
 * somebody had decided about would be the same silence the withdrawal was
 * supposed to break: the rule that asked is still on that place, and the person
 * is the only one who can decide whether to change it.
 *
 * The rules are named as the assignment recorded them, which is the rule's name
 * as it stood when it asked. That is history and it is read back rather than
 * recomputed, for the same reason `reason` carries it on the assignment itself:
 * the rule may have been renamed or taken off the place since, and what this
 * says is what was asked for.
 */
export interface SetAside {
  fromAreaId: number
  toAreaId: number
  /** Where the books are, and are staying. */
  from: string
  /** Where the rules asked for them, and where they are not going. */
  to: string
  books: number
  /** The rules that asked, by name, without repeats. */
  rules: string[]
}

export interface CarryWork {
  /** How many books are in the trips, which is the headline number. */
  moving: number
  trips: CarryTrip[]
  /** Everything the rules will not move, and why. Never silently empty. */
  skipped: CarrySkipped[]
  carried: CarriedAlready
  /** Null when the newest run of the rules changed nothing anybody would read. */
  changed: CarryChange | null
  /**
   * Work somebody has taken off the list by leaving the books where they are.
   *
   * Empty on a list nobody has done that to, which is every list until somebody
   * does.
   */
  setAside: SetAside[]
}

/*
 * The pictures travel with the name, because they are half of what a name is
 * for here. This function is the one narrowing on the way out of this file, and
 * it was the place both of them were dropped: every carry screen drew a row of
 * coloured blocks with no photograph on it and no spine to it, while the same
 * components drew photographed books everywhere else in the app.
 */
const named = (book: CarryableBook): CarriedBook => ({
  id: book.id,
  title: book.title,
  authorFiling: book.authorFiling,
  spine: book.spine,
  cover: book.cover,
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

/** One end of a carry that has already happened. */
interface Carry {
  fromAreaId: number
  toAreaId: number
  /** When the book was put down. */
  at: string
}

/**
 * The last time somebody carried this book because the app asked them to.
 *
 * The shape in the ledger is an `assigned` row naming an area followed by a
 * `placed` row landing in it, and the other end of the carry is wherever the
 * book was standing immediately before. A book somebody moved of their own
 * accord has the `placed` row and no assignment behind it, and is not a carry:
 * saying it was would let the app take credit for work it never asked for.
 *
 * The fold is `standingOf`'s, deliberately, down to `assigned` surviving a
 * `placed` row and a pin clearing it. Two folds that drifted would put a book
 * on the list and off the tally in the same breath.
 */
export function lastCarry(rows: readonly Placement[]): Carry | null {
  let assigned: number | null = null
  let area: number | null = null
  let found: Carry | null = null

  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    switch (row.kind) {
      case 'assigned':
        assigned = row.areaId
        break
      case 'placed':
        if (assigned !== null && row.areaId === assigned && area !== null && area !== row.areaId) {
          found = { fromAreaId: area, toAreaId: row.areaId, at: row.createdAt }
        }
        area = row.areaId
        break
      case 'released':
        // Where the book stands is untouched: nobody moved it. What goes is the
        // assignment, so a carry that never happened is not read back as one.
        assigned = null
        break
      case 'pinned':
        area = row.areaId
        assigned = null
        break
      default:
        area = null
        assigned = null
        break
    }
  }

  return found
}

/** The day part of a timestamp, which is as fine as "carried on Sunday" needs. */
const dayOf = (at: string): string => at.slice(0, 10)

/**
 * Work out what is still to be carried, and how somebody would walk it.
 *
 * `where` is every area the collection has ever had on a face, retired ones
 * included, because half of every trip after a run move names a plank that has
 * been taken out and is still what somebody reads off the furniture.
 */
export function carryWork(
  books: readonly CarryableBook[],
  rows: readonly Placement[],
  where: ReadonlyMap<number, AreaFace>,
): CarryWork {
  const history = rowsByBook(rows)

  const trips = new Map<string, CarryTrip>()
  /** The oldest standing assignment behind each trip: when this stretch began. */
  const began = new Map<string, string>()
  const skipped = new Map<CarrySkip, number>()
  let moving = 0

  const skip = (reason: CarrySkip) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
  const key = (from: number, to: number) => `${from}:${to}`

  for (const book of books) {
    const own = history.get(book.id) ?? []
    const standing = standingOf(own)

    if (standing.pinned) { skip('pinned'); continue }
    if (standing.checkedOut) { skip('checked-out'); continue }
    if (standing.withdrawn) { skip('withdrawn'); continue }
    if (!needsAttention(standing)) continue

    const to = standing.assigned!
    if (standing.area === null) { skip('never-placed'); continue }
    const from = standing.area

    const at = key(from, to)
    const trip = trips.get(at) ?? {
      fromAreaId: from,
      toAreaId: to,
      from: where.get(from)?.label ?? '',
      to: where.get(to)?.label ?? '',
      books: [],
      carried: 0,
    }
    trip.books.push(named(book))
    trips.set(at, trip)
    moving += 1

    /*
     * When the rules last said these books belong somewhere else. Every book on
     * one trip was usually assigned by one run, so the oldest of them is when
     * this stretch of work began, and a carry recorded after it belongs to this
     * stretch rather than to some older one on the same pair of areas.
     */
    const assignment = own
      .filter((row) => row.kind === 'assigned' && row.areaId === to)
      .sort((a, b) => a.id - b.id)[0]
    const since = assignment?.createdAt ?? ''
    const already = began.get(at)
    if (since && (already === undefined || since < already)) began.set(at, since)
  }

  /*
   * The books that are already down, counted against the trip they belong to.
   * They are not on the list, which is the whole point: a book that has been
   * carried takes itself off it. This is only so a resumed trip can say how much
   * of it is done.
   */
  const days = new Map<string, number>()
  for (const book of books) {
    const carry = lastCarry(history.get(book.id) ?? [])
    if (!carry) continue

    const day = dayOf(carry.at)
    days.set(day, (days.get(day) ?? 0) + 1)

    const at = key(carry.fromAreaId, carry.toAreaId)
    const trip = trips.get(at)
    const since = began.get(at)
    if (trip && since && carry.at >= since) trip.carried += 1
  }

  const latest = [...days.keys()].sort().pop() ?? ''

  return {
    moving,
    trips: walked([...trips.values()], where),
    skipped: CARRY_SKIPS
      .filter((reason) => skipped.has(reason))
      .map((reason) => ({ reason, books: skipped.get(reason)! })),
    carried: { books: latest ? days.get(latest)! : 0, when: latest },
    changed: changeOf(books, history, where),
    setAside: setAsideOf(books, history, where),
  }
}

/**
 * The work somebody has decided not to do, grouped the way they decided it.
 *
 * By the same pair a trip is, because that is the shape the decision was made
 * in: somebody looking at "twenty-two books, 4C to 3C" said no to that, and
 * saying so back in those words is what makes it recognisable as the thing they
 * did rather than as a count of books they have to reconstruct.
 *
 * A pinned, checked out or withdrawn book cannot be here. A pin clears the
 * memory along with the assignment, and so does going out of the house, because
 * after either of those the question the person answered no longer exists.
 */
function setAsideOf(
  books: readonly CarryableBook[],
  history: ReadonlyMap<number, Placement[]>,
  where: ReadonlyMap<number, AreaFace>,
): SetAside[] {
  const groups = new Map<string, SetAside>()

  for (const book of books) {
    const own = history.get(book.id) ?? []
    const standing = standingOf(own)
    if (standing.declined === null || standing.area === null) continue
    if (standing.declined === standing.area) continue
    if (standing.pinned || standing.checkedOut || standing.withdrawn) continue

    const at = `${standing.area}:${standing.declined}`
    const group = groups.get(at) ?? {
      fromAreaId: standing.area,
      toAreaId: standing.declined,
      from: where.get(standing.area)?.label ?? '',
      to: where.get(standing.declined)?.label ?? '',
      books: 0,
      rules: [],
    }
    group.books += 1

    /*
     * The rule that asked, off the assignment this withdrawal answered. The
     * newest one naming that area: a rule change can have asked twice, and what
     * was withdrawn is the last thing it asked.
     */
    const asked = own
      .filter((row) => row.kind === 'assigned' && row.areaId === standing.declined)
      .sort((a, b) => b.id - a.id)[0]
    const name = asked?.reason ?? ''
    if (name && !group.rules.includes(name)) group.rules.push(name)

    groups.set(at, group)
  }

  return [...groups.values()].sort((a, b) => b.books - a.books
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to))
}

/**
 * The trips in the order somebody would walk them.
 *
 * Pieces first, most to come off them first, because emptying a piece
 * completely is the win and three books off a bookcase across the room is not
 * what anybody does before clearing the one with fifty on it. Then the areas of
 * a piece in the order they stand on it, which is the closest thing to a path.
 * A piece that is drawing level with another falls back to its number, so the
 * order is the same every time the list is drawn.
 */
function walked(trips: CarryTrip[], where: ReadonlyMap<number, AreaFace>): CarryTrip[] {
  const load = new Map<number, number>()
  for (const trip of trips) {
    const at = where.get(trip.fromAreaId)
    if (!at) continue
    load.set(at.fixtureId, (load.get(at.fixtureId) ?? 0) + trip.books.length)
  }

  const place = (trip: CarryTrip) => {
    const at = where.get(trip.fromAreaId)
    if (!at) return { books: -1, fixture: Number.MAX_SAFE_INTEGER, area: 0 }
    return {
      books: load.get(at.fixtureId) ?? 0,
      fixture: at.fixturePosition,
      area: at.areaPosition,
    }
  }

  return trips.sort((a, b) => {
    const left = place(a)
    const right = place(b)
    return right.books - left.books
      || left.fixture - right.fixture
      || left.area - right.area
      || a.to.localeCompare(b.to)
  })
}

/**
 * What the newest run of the rules did, read off the ledger rather than off a
 * session nobody kept.
 *
 * A run writes its `assigned` rows with one timestamp, so the newest timestamp
 * on any assignment names one run and the rows carrying it are what it did. Fold
 * each of those books twice, once with the run and once without, and the
 * difference is what somebody would notice.
 *
 * ## The counts are of the change and not of the list
 *
 * Both folds stop at the run, by row id, so nothing written afterwards moves
 * them. **A count that included later rows would go backwards as somebody
 * worked**: carry three of the twenty books a rule change added and it would
 * report seventeen added, which is the screen contradicting the work being done
 * in front of it. That happened on a real list the first time this was walked.
 *
 * The named books are the exception, and for the opposite reason: they are work
 * rather than history, so a book somebody has already carried again is off them.
 */
function changeOf(
  books: readonly CarryableBook[],
  history: ReadonlyMap<number, Placement[]>,
  where: ReadonlyMap<number, AreaFace>,
): CarryChange | null {
  /*
   * The last assignment written, by id rather than by timestamp, and the run it
   * belongs to is every assignment carrying that run's timestamp. Both halves
   * matter: `id` is the order rows were written and is the only order this model
   * trusts, and the timestamp is what one run of the rules stamps all its rows
   * with, so it is what says which rows are one decision.
   */
  let last: Placement | null = null
  for (const own of history.values()) {
    for (const row of own) {
      if (row.kind === 'assigned' && (!last || row.id > last.id)) last = row
    }
  }
  if (!last) return null

  const newest = last.createdAt
  const inRun = (row: Placement) => row.kind === 'assigned' && row.createdAt === newest

  let cutoff = 0
  for (const own of history.values()) {
    for (const row of own) if (inRun(row) && row.id > cutoff) cutoff = row.id
  }

  const change: CarryChange = { left: 0, joined: 0, again: [] }

  for (const book of books) {
    const own = history.get(book.id) ?? []
    if (!own.some(inRun)) continue

    const until = own.filter((row) => row.id <= cutoff)
    const before = until.filter((row) => !inRun(row))
    const after = standingOf(until)
    const was = standingOf(before)

    const on = needsAttention(after) && after.area !== null
    const onBefore = needsAttention(was) && was.area !== null

    if (on && !onBefore) {
      change.joined += 1

      const now = standingOf(own)
      const outstanding = needsAttention(now) && now.area !== null
      if (outstanding && lastCarry(before)) {
        change.again.push({
          book: named(book),
          from: where.get(now.area!)?.label ?? '',
          to: where.get(now.assigned!)?.label ?? '',
        })
      }
    } else if (onBefore && !on) {
      change.left += 1
    }
  }

  return change.joined || change.left ? change : null
}

/** One book on the area a trip comes off, and whether it is going anywhere. */
export interface StandingBook extends CarriedBook {
  /** Page count, so a drawn spine is the thickness of the real book. */
  pages: number
  /** On this trip: it comes off here and goes to the area the trip names. */
  going: boolean
  /**
   * Why it is not going, for the ones that are staying.
   *
   * `left` is a book somebody decided to leave where it stands, and it is its
   * own answer rather than `settled`: settled means the rules want it here, and
   * saying that about a book whose assignment a person turned down would be the
   * app quietly agreeing with itself about a decision it did not make.
   */
  staying: 'pinned' | 'elsewhere' | 'settled' | 'left' | null
}

/**
 * One trip read at the area the books come off: what is on it, and which of it
 * to take.
 *
 * The books that are staying are drawn rather than hidden. Somebody standing at
 * eleven spines being shown eight is counting to eleven and wondering; the three
 * that are staying are the answer to that, and the reason each of them is
 * staying is the only thing that makes it an answer.
 *
 * `books` arrives in sort order and leaves in it, because the order this
 * answers in is the order the spines stand on the area.
 */
export function booksOnArea(
  books: readonly CarryableBook[],
  pages: ReadonlyMap<number, number>,
  rows: readonly Placement[],
  fromAreaId: number,
  toAreaId: number,
): StandingBook[] {
  const history = rowsByBook(rows)
  const standing: StandingBook[] = []

  for (const book of books) {
    const own = standingOf(history.get(book.id) ?? [])
    if (own.area !== fromAreaId) continue

    const going = needsAttention(own) && own.assigned === toAreaId
    standing.push({
      ...named(book),
      pages: pages.get(book.id) ?? 0,
      going,
      staying: going ? null
        : own.pinned ? 'pinned'
          : needsAttention(own) ? 'elsewhere'
            : own.declined !== null ? 'left' : 'settled',
    })
  }

  return standing
}
