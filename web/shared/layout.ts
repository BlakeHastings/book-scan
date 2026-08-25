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

import { parseLocation, type ShelfRange } from './shelving'

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

/**
 * `areaLabel` read backwards: which plank a run of letters names.
 *
 * Bijective base 26, so `A` is 0, `Z` is 25 and `AA` is 26, and
 * `areaIndex(areaLabel(n)) === n` for every n. Written here rather than wherever
 * it is needed because an inverse that lives away from what it inverts is an
 * inverse that stops being one: the two have to be changed together or a plank
 * gets one label and answers to another.
 *
 * -1 for anything that is not a run of letters, which includes the empty string.
 * A bare bookcase (`S4`) parses as a location and names no plank, so it has no
 * index rather than index zero: `4` and `4A` are not the same place, and
 * `compareLocations` already sorts them apart.
 */
export function areaIndex(section: string): number {
  if (!/^[A-Za-z]+$/.test(section)) return -1

  let n = 0
  for (const character of section.toUpperCase()) {
    n = n * 26 + (character.charCodeAt(0) - 64)
  }
  return n - 1
}

/** Shelf first, then area: 1A is the top plank of bookcase 1. */
export function locationLabel(shelf: number, area: number): string {
  return `${shelf}${areaLabel(area)}`
}

/**
 * `locationLabel` read backwards: the plank an address of this form names.
 *
 * Here for the reason `areaIndex` above is here: an inverse that lives away from
 * what it inverts stops being one, and the two have to change together or a
 * plank gets one address and answers to another.
 *
 * **This is not the way to find out where a book goes.** An address is a
 * rendering of a pair of ordinals and nothing more; what says two places are one
 * place is the area's id, which is why the routes take one (#356, #359) and why
 * `Shelves.addressOf` is the single door between an id and this form. What this
 * is for is reading back an address the app itself wrote a moment ago, which is
 * what a seeder and a test do when they say a named plank is full.
 *
 * Null for anything that is not one, including a label somebody has typed a
 * fixture's name into: `Hall shelf · B` is a rendering for a person and names no
 * plank here.
 */
export function plankAt(label: string): PlankAt | null {
  const parsed = parseLocation(label)
  if (!parsed) return null

  const area = areaIndex(parsed.section)
  return area < 0 ? null : { shelf: parsed.shelf, area }
}

/**
 * Which plank, as the furniture is numbered rather than as anybody reads it.
 *
 * The whole of what this file knows about a place, and it knows nothing about
 * what the place is called: `locationLabel` renders one of these and the
 * rendering is thrown away by everything that has to decide something. A run's
 * areas stand in this order and carry their own ids, so a caller holding a pair
 * of numbers can ask the furniture which row it is (`areaAt` in
 * infrastructure/shelving/areas.ts) and name it for a person from there.
 *
 * This is what a plan hands back beside its label. Without it the only thing a
 * caller had to say where a book was going was a string built out of two
 * ordinals, which is a rendering, and #356 is what happens when a rendering is
 * asked to be an identity.
 */
export interface PlankAt {
  /** Bookcase, 1-based. */
  shelf: number
  /** Plank within it, 0-based. */
  area: number
}

/** Where a range begins on the furniture. Non-fiction lives on bookcase 4. */
export type RangeStart = PlankAt

export const FIRST_SHELF: RangeStart = { shelf: 1, area: 0 }

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
  start: RangeStart = FIRST_SHELF,
): Placed<T>[] {
  const ordered = [...separators]
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))

  // Ranges do not all begin at 1A. Non-fiction has its own bookcase, and
  // laying both out from 1A gave two different planks the same name.
  let shelf = start.shelf
  let area = start.area
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
  /** The two planks as the furniture is numbered. See `PlankAt`. */
  fromAt: PlankAt
  toAt: PlankAt
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
  const was = new Map(before.map((p) => [p.book.id, p]))
  const moves: Move[] = []

  for (const placed of after) {
    const from = was.get(placed.book.id)
    if (from !== undefined && from.label !== placed.label) {
      moves.push({
        id: placed.book.id,
        from: from.label,
        to: placed.label,
        fromAt: { shelf: from.shelf, area: from.area },
        toAt: { shelf: placed.shelf, area: placed.area },
      })
    }
  }

  return moves
}

/**
 * The boundary a group begins at.
 *
 * A separator belongs to the group it OPENS, and that is the whole of the
 * decision: `startsAt` is the sort key of the first book on the new plank
 * (see `Separator`, and "What actually changes" in docs/shelving.md), so the
 * group whose first book carries that key is the one the boundary is about.
 *
 * Kept as one object rather than as two loose fields because the two used to
 * be read apart. `group.kind` reads like a property of the group, which is how
 * a bookcase break came to be drawn under the bookcase it started (#145).
 */
export interface GroupOpener {
  id: number
  kind: SeparatorKind
}

export interface ShelfGroup<T extends LayoutInput = LayoutInput> {
  /** Bookcase, 1-based. */
  shelf: number
  /** Plank within it, 0-based. */
  area: number
  label: string
  books: Placed<T>[]
  /**
   * The boundary this shelf begins at, if it is not the first.
   *
   * It is this group's own boundary, not the one after it. Anything drawing it
   * draws it above this group's heading, and `libraryRows` is how, so that
   * where the line sits and which boundary it removes cannot part company.
   */
  opensWith: GroupOpener | null
}

/**
 * Group a layout for display, one entry per physical shelf, carrying the
 * separator that opens it.
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
      opensWith: opener ? { id: opener.id, kind: opener.kind } : null,
    })
  }

  return groups
}

/** What a boundary line says, in the words the person reads. */
export function dividerNotice(kind: SeparatorKind): string {
  return kind === 'shelf' ? 'New bookcase starts here' : 'New area starts here'
}

/** One thing the library draws, in the order it is read down the page. */
export type LibraryRow<G extends { label: string; opensWith: GroupOpener | null }> =
  | {
      row: 'divider'
      /** The boundary this line removes. */
      separatorId: number
      kind: SeparatorKind
      /** What the line says. */
      notice: string
      /** The group it opens, which is the heading directly beneath it. */
      opens: string
    }
  | { row: 'shelf'; group: G }

/**
 * The library as one sequence, boundary lines included.
 *
 * Which side of a group its boundary is drawn on is a fact about the boundary,
 * so it is decided here, once, rather than by where a component happens to put
 * a `<div>`. A separator opens a group, so its line comes immediately before
 * that group's heading and carries that group's boundary id.
 *
 * This is #145. The layout said "opens" and the rendering said "closes", so
 * every line named the heading above it while removing the boundary of the
 * heading below it: the labels contradicted the headings, and Remove deleted a
 * boundary one place away from the one it named. Somebody was told to carry
 * four books to planks they did not belong on. Shifting the drawing alone
 * would have fixed the reading and left the removal wrong, which is worse,
 * because then nothing on screen says so. The sentence and the id it removes
 * come out of the same row here for exactly that reason.
 */
export function libraryRows<G extends { label: string; opensWith: GroupOpener | null }>(
  groups: G[],
): LibraryRow<G>[] {
  const rows: LibraryRow<G>[] = []

  for (const group of groups) {
    if (group.opensWith) {
      rows.push({
        row: 'divider',
        separatorId: group.opensWith.id,
        kind: group.opensWith.kind,
        notice: dividerNotice(group.opensWith.kind),
        opens: group.label,
      })
    }
    rows.push({ row: 'shelf', group })
  }

  return rows
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
  /** The two planks as the furniture is numbered. See `PlankAt`. */
  fromAt: PlankAt
  toAt: PlankAt
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
 *
 * **A shelf holding one book gives that book up like any other** (#432). It
 * used to refuse, on the reasoning that moving the only book along would empty
 * the shelf. Emptying it is the point: what the person needs is a gap on the
 * plank the book in their hand belongs on, and on a plank holding one book the
 * gap is the whole plank. `docs/shelving.md` says so twice, and neither place
 * makes room for a special case:
 *
 *   "Anywhere else, a book has to come off the end. [...] the last book on the
 *    plank goes to the start of the next one. That is the cascade"
 *
 *   "The only book in an area. Allowed, in both directions. The plank it
 *    leaves is then empty, which is exactly what happened in the room."
 *
 * The second is written of a boundary moved by hand, and the same document
 * says the hand and the cascade must write the same thing: "a manual move and
 * an automatic shuffle answer the same physical question, and if they wrote
 * different things down one would quietly undo the other. The two differ only
 * at the ends of the run". A one-book plank is not an end of the run, so the
 * refusal was the code disagreeing with the specification.
 *
 * Null now means one thing and one thing only: this run has no such plank.
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
  const moved = group.books[group.books.length - 1]!.book
  const nextGroup = groups[index + 1]
  const fromAt: PlankAt = { shelf: group.shelf, area: group.area }
  // One step along the run, which is either the plank below or the top of the
  // next bookcase. The label is that address rendered, never the other way
  // round: the address is what says which plank, and the string is for reading.
  const step = (kind: SeparatorKind): { to: string; toAt: PlankAt } => {
    const toAt: PlankAt = kind === 'shelf'
      ? { shelf: group.shelf + 1, area: 0 }
      : { shelf: group.shelf, area: group.area + 1 }
    return { to: locationLabel(toAt.shelf, toAt.area), toAt }
  }

  if (!nextGroup) {
    return {
      moved,
      from: label,
      fromAt,
      ...step(kindIfNew),
      create: { startsAt: moved.sortKey, kind: kindIfNew },
    }
  }

  // Asking for a new bookcase when the next boundary is only a plank break
  // needs a boundary of its own, inserted before it. Shifting the plank break
  // instead would keep everything in this bookcase, which is the opposite of
  // what was asked. The existing break survives and now divides the NEW
  // bookcase, so the books after it move along too, which is right: the whole
  // run past a full bookcase belongs in the next one.
  if (kindIfNew === 'shelf' && nextGroup.opensWith?.kind !== 'shelf') {
    return {
      moved,
      from: label,
      fromAt,
      ...step('shelf'),
      create: { startsAt: moved.sortKey, kind: 'shelf' },
    }
  }

  return {
    moved,
    from: label,
    fromAt,
    /*
     * One boundary along from where the book is, not "the label of the next
     * group".
     *
     * Those are the same thing on a run of occupied planks, and they part
     * company as soon as one is bare: an area with nothing on it has no books
     * to name it, so it is absent from the groups, and reading the
     * destination off the next group named the plank after the empty one.
     * The book then went to the plank the app could see and was recorded on
     * the one it named, which is a misfile the app manufactured itself.
     *
     * Exactly one boundary comes to rest on this book, the one being shifted,
     * so its kind decides the step. Deriving both from the same separator is
     * what keeps the label and the layout in agreement.
     */
    ...step(nextGroup.opensWith?.kind === 'shelf' ? 'shelf' : 'area'),
    // The next shelf now starts one book earlier.
    shift: nextGroup.opensWith
      ? { id: nextGroup.opensWith.id, startsAt: moved.sortKey }
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// Moving a book across an area boundary
// ---------------------------------------------------------------------------

/**
 * Boundaries lying strictly after one sort key and no later than another, in
 * the order a book meets them.
 *
 * Usually one. Two when a boundary move emptied an area, which leaves its
 * boundary sitting on the same anchor as the next one, so a caller that acts
 * on only one of them carries a book two planks instead of one.
 */
function boundariesBetween(
  separators: Separator[],
  low: string,
  high: string,
): Separator[] {
  return separators
    .filter((s) => s.startsAt > low && s.startsAt <= high)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))
}

/** Which way along the run the book is being carried. */
export type BoundaryDirection = 'next' | 'previous'

/** Why a book cannot be carried across a boundary. */
export type BoundaryRefusal =
  /** Not in this run at all: wrong range, or off the bookcase entirely. */
  | 'not-shelved'
  /**
   * Somewhere in the middle of its area.
   *
   * The whole restriction in one word. Only the first and last book of an
   * area have the property that moving them leaves every neighbour in the
   * sequence untouched; any other book cannot move without breaking the
   * ordering docs/shelving.md makes the source of truth.
   */
  | 'not-at-boundary'
  /** First or last, but with no area on that side to move into. */
  | 'no-adjacent-area'

export interface BoundaryMove {
  /** The book to pick up. */
  moved: LayoutInput
  from: string
  to: string
  /** The two planks as the furniture is numbered. See `PlankAt`. */
  fromAt: PlankAt
  toAt: PlankAt
  /** Boundaries to re-anchor, and the sort key each one now starts at. */
  shift: { id: number; startsAt: string }[]
  /** Boundaries to drop, because nothing is left for them to start at. */
  remove: number[]
}

export type BoundaryOutcome =
  | { ok: true; move: BoundaryMove }
  /**
   * The plank the refusal is about, so the sentence can name it the way the
   * book's own page does. `at` is the rendering and `atAt` is the plank; a
   * refusal at no plank at all (`not-shelved`) has neither.
   */
  | { ok: false; reason: BoundaryRefusal; at: string; atAt: PlankAt | null }

/**
 * Take the first or last book of an area and put it on the plank next door.
 *
 * Where an area ends is the one arbitrary thing in this model. It is decided
 * by where somebody ran out of room, not by the books, so it needs adjusting
 * by hand. This is that adjustment, and the restriction to the first or last
 * book is not a simplification of a general move: it is the complete set of
 * moves that leave the sequence alone.
 *
 *   - the LAST book of an area becomes the FIRST of the next one. The book
 *     before it and the book after it are unchanged.
 *   - the FIRST book of an area becomes the LAST of the previous one. Same.
 *
 * Nothing else is offered because nothing else is physically real: a book
 * plucked out of the middle of a plank and put on the next one is a book
 * filed out of order, which is the state misfile detection exists to report.
 *
 * The boundary is what moves, not the book's key. A boundary is anchored to
 * the sort key of the first book on the new plank, so carrying a book across
 * one is exactly re-anchoring that boundary to the book on the other side of
 * it. This is the same edit `overflow` makes when a shelf is declared full,
 * which is deliberate: a manual move and an automatic shuffle are two ways of
 * answering the same physical question, and they had better write the same
 * thing down. The difference is at the ends of the run, where `overflow`
 * creates a new area and this refuses, because moving a book *between* areas
 * is not the same act as deciding a plank is full.
 *
 * `placed` must be the whole range in sort order, as `layoutRange` returns it.
 */
export function boundaryMove<T extends LayoutInput>(
  placed: Placed<T>[],
  separators: Separator[],
  bookId: number,
  direction: BoundaryDirection,
): BoundaryOutcome {
  const index = placed.findIndex((p) => p.book.id === bookId)
  if (index === -1) return { ok: false, reason: 'not-shelved', at: '', atAt: null }

  const here = placed[index]!
  const before = placed[index - 1]
  const after = placed[index + 1]

  const between = (low: string, high: string) => boundariesBetween(separators, low, high)
  // Where a plank stands, taken off the layout that drew it rather than parsed
  // back out of the string it drew. See `PlankAt`.
  const plankOf = (one: Placed<T>): PlankAt => ({ shelf: one.shelf, area: one.area })
  const refused = (reason: BoundaryRefusal): BoundaryOutcome =>
    ({ ok: false, reason, at: here.label, atAt: plankOf(here) })

  if (direction === 'next') {
    // Last on its plank: either nothing follows, or what follows is elsewhere.
    if (after && after.label === here.label) return refused('not-at-boundary')
    if (!after) return refused('no-adjacent-area')

    const crossed = between(here.book.sortKey, after.book.sortKey)
    if (!crossed.length) return refused('no-adjacent-area')

    return {
      ok: true,
      move: {
        moved: here.book,
        from: here.label,
        to: after.label,
        fromAt: plankOf(here),
        toAt: plankOf(after),
        // The next area now begins one book earlier, at this one.
        shift: crossed.map((s) => ({ id: s.id, startsAt: here.book.sortKey })),
        remove: [],
      },
    }
  }

  if (before && before.label === here.label) return refused('not-at-boundary')
  if (!before) return refused('no-adjacent-area')

  const crossed = between(before.book.sortKey, here.book.sortKey)
  if (!crossed.length) return refused('no-adjacent-area')

  return {
    ok: true,
    move: {
      moved: here.book,
      from: here.label,
      to: before.label,
      fromAt: plankOf(here),
      toAt: plankOf(before),
      // The area this book is leaving now begins at whatever follows it. With
      // nothing following, it has no first book, so the boundary describes a
      // place no book is on and goes.
      shift: after ? crossed.map((s) => ({ id: s.id, startsAt: after.book.sortKey })) : [],
      remove: after ? [] : crossed.map((s) => s.id),
    },
  }
}

// ---------------------------------------------------------------------------
// Placing a book on a plank that is full
// ---------------------------------------------------------------------------

/**
 * The book in your hand goes on the next plank, and nothing already shelved
 * moves at all.
 */
export interface CarryOn {
  /** The full plank the book was about to go on. */
  from: string
  /** The plank it goes on instead. */
  to: string
  /** The two planks as the furniture is numbered. See `PlankAt`. */
  fromAt: PlankAt
  toAt: PlankAt
  /** Boundary to re-anchor to the book being placed. */
  shift?: { id: number; startsAt: string }
  /** Boundary to create, when the plank it goes on does not exist yet. */
  create?: { startsAt: string; kind: SeparatorKind }
}

/**
 * A sort key no real one can reach, for "everything from here on".
 *
 * Sort key components are normalised to `[A-Z0-9 ]` and joined with the unit
 * separator, so a tilde is above every character one can contain.
 */
const END_OF_RUN = '~'

/**
 * The special case that has to be tried before the cascade.
 *
 * When the book being placed belongs at the END of a plank and that plank is
 * full, the book itself is the one that moves. It goes to the start of the
 * next plank and nothing already shelved is touched, because the book is
 * already at the boundary: sliding it across passes no other book, so the
 * sequence is unchanged.
 *
 * The cascade is what happens instead when the gap is in the MIDDLE of the
 * plank, and it is right there: something genuinely has to come off the end to
 * open a gap, and only a person can say the plank is full in the first place.
 * Reaching the cascade for a book that belongs at the end asked somebody to
 * pull a different book off the shelf and carry it next door, then put the new
 * book down where it had been. That produced the same ordering with two books
 * handled instead of one, and the one displaced went somewhere it did not need
 * to go. Hence #77.
 *
 * Returns null when the book does not belong at the end of `label`, which is
 * the caller's signal to fall through to `overflow`. That includes the case
 * where the book is not on `label` at all, which is what makes it safe to pass
 * the book in hand on every rung of the cascade: the special case fires only
 * for the plank the book is actually about to go on.
 *
 * Unlike `boundaryMove`, this stops at the FIRST boundary rather than landing
 * where the next book is. The two are answering different questions. A
 * boundary move is offered against a named plank and must land on the plank it
 * named; this is answering "then where does it go", and if the very next plank
 * is bare then a bare plank is exactly where a book with nowhere to go should
 * end up.
 *
 * `placed` must be the run laid out WITH the newcomer in it, under
 * NEWCOMER_ID, as `layoutRange` returns it for a merged run.
 */
export function carryOn<T extends LayoutInput>(
  placed: Placed<T>[],
  separators: Separator[],
  label: string,
  kindIfNew: SeparatorKind = 'area',
): CarryOn | null {
  const index = placed.findIndex((p) => p.book.id === NEWCOMER_ID)
  if (index === -1) return null

  const here = placed[index]!
  if (here.label !== label) return null

  // Something on this plank sorts after the book, so a gap really does have to
  // be opened and the cascade is the right answer.
  const after = placed[index + 1]
  if (after && after.label === here.label) return null

  const crossed = boundariesBetween(
    separators,
    here.book.sortKey,
    after ? after.book.sortKey : END_OF_RUN,
  )
  const next = crossed[0]

  const step = (kind: SeparatorKind) => {
    const toAt: PlankAt = kind === 'shelf'
      ? { shelf: here.shelf + 1, area: 0 }
      : { shelf: here.shelf, area: here.area + 1 }
    return {
      from: label,
      to: locationLabel(toAt.shelf, toAt.area),
      fromAt: { shelf: here.shelf, area: here.area },
      toAt,
    }
  }

  /*
   * No boundary to cross, or a new bookcase asked for where the next boundary
   * is only a plank break. Either way the plank it goes on does not exist yet
   * and gets made, which is the same answer `overflow` gives at the end of the
   * run. Nothing is displaced by it: the new boundary is anchored to the book
   * being placed, so every book already shelved stays exactly where it is.
   */
  if (!next || (kindIfNew === 'shelf' && next.kind !== 'shelf')) {
    return {
      ...step(kindIfNew),
      create: { startsAt: here.book.sortKey, kind: kindIfNew },
    }
  }

  return {
    ...step(next.kind),
    // The next plank now begins at this book rather than at the one after it.
    shift: { id: next.id, startsAt: here.book.sortKey },
  }
}

/**
 * The id used for a book that does not exist yet.
 *
 * Placement has to name a real shelf before the book is saved, so the
 * newcomer is slotted into the run under this id and picked back out again.
 */
export const NEWCOMER_ID = -1

export interface Strip<T extends LayoutInput> {
  /** The shelf the newcomer lands on. */
  label: string
  /** That shelf as the furniture is numbered, so it can be named. See `PlankAt`. */
  at: PlankAt
  /** Everything already on that shelf, left to right. */
  books: Placed<T>[]
  /** How many of those books sit to the left of the gap. */
  gapIndex: number
}

/**
 * One physical shelf, seen end on, with the space one book goes in.
 *
 * A neighbour pair tells you what to look for but not what you are looking
 * at: five books to the left and two to the right is a different search from
 * the other way round, and the pair alone cannot say which. This returns the
 * whole row so the gap can be drawn in place.
 *
 * Takes a layout the named book is already positioned in, and lifts it back
 * out, leaving the hole it would fill. Which book that is depends on the
 * question: a newcomer being catalogued goes in under NEWCOMER_ID, and a book
 * a cascade proposes to carry next door is a real shelved book laid out
 * against the boundary the move would set. The two are the same picture and
 * are drawn by the same code, because a second way to draw a gap would drift
 * from the first (#112).
 */
export function stripWithGap<T extends LayoutInput>(
  placed: Placed<T>[],
  id: number,
): Strip<T> | null {
  const found = stripAt(placed, id)
  if (!found) return null

  return {
    label: found.label,
    at: found.at,
    books: found.books.filter((p) => p.book.id !== id),
    // Its index within the row, which is exactly the count to its left.
    gapIndex: found.index,
  }
}

/** The gap a book being catalogued leaves, which is the commonest case. */
export function stripAround<T extends LayoutInput>(
  placed: Placed<T>[],
): Strip<T> | null {
  return stripWithGap(placed, NEWCOMER_ID)
}

/**
 * The shelf one book is on, and where along it that book sits.
 *
 * The same row as stripAround, but for a book that is already shelved rather
 * than one being fitted in. Nothing is removed, so the book appears in its
 * own row at `index`.
 */
export function stripAt<T extends LayoutInput>(
  placed: Placed<T>[],
  id: number,
): { label: string; at: PlankAt; books: Placed<T>[]; index: number } | null {
  const on = placed.find((p) => p.book.id === id)
  if (!on) return null

  const books = placed.filter((p) => p.label === on.label)
  return {
    label: on.label,
    at: { shelf: on.shelf, area: on.area },
    books,
    index: books.findIndex((p) => p.book.id === id),
  }
}
