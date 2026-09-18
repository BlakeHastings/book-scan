/**
 * Arranging the furniture: what adding, renaming, reordering or removing a
 * piece does to the labels somebody reads off it.
 *
 * Everything here is arithmetic over the areas of one fixture's face, in the
 * order they sit on it. Nothing writes and nothing reads a row: the unique index
 * on the stored ordinal, and the collision it causes, is
 * `infrastructure/shelving/furniture.ts`'s problem.
 *
 * A label is derived from a fixture's position and name and an area's position
 * and name, so every one of these operations changes labels and none of them
 * changes a book. That is why each answer carries `becomes`, which is every
 * label that reads differently afterwards, old to new.
 *
 * Removing an area is a merge, and it has three shapes:
 *
 * 1. Something before it. Its books join the area before it, which keeps its own
 *    anchor, and nothing else on the face moves.
 * 2. Nothing before it. The area after it comes forward and the whole run of
 *    labels shuffles up. The area coming forward takes over the removed one's
 *    anchor, because opening where the removed area opened is what makes those
 *    books fall into it.
 * 3. Nothing before or after it. A piece with one area has nowhere on it for
 *    those books, so this refuses. The way out is deleting the piece.
 *
 * No book is deleted and no placement is, in any of the three. What the removal
 * does to the ledger is `server/furniture.ts`'s job.
 */

import { labelFor, startsARun, type Slot } from './geography'
import { type SortStrategy } from './strategies'

/** An area that has to take a different ordinal, and the one it takes. */
export interface Reordering {
  id: number
  from: number
  to: number
}

/** A label as it reads now and as it will read. */
export interface LabelChange {
  from: string
  to: string
}

/**
 * `order` is the ids in the order they will sit, which is what a writer needs;
 * `moves` and `becomes` are the same change said to a person.
 */
export interface FaceChange {
  order: number[]
  moves: Reordering[]
  becomes: LabelChange[]
}

/** The ordinal an area takes on the face, which is the `A` in `1A`. */
const relabel = (slot: Slot, position: number): string =>
  labelFor({ fixture: slot.fixture, area: { ...slot.area, position } })

/**
 * Every label on a face that reads differently once the areas sit in `order`.
 * An area whose ordinal does not change is not listed, and neither is a named
 * one that merely shuffled: `2 · Cookery` reads the same wherever it sits.
 */
function relabelled(face: readonly Slot[], order: readonly number[]): LabelChange[] {
  const changes: LabelChange[] = []
  order.forEach((id, position) => {
    const slot = face.find((one) => one.area.id === id)
    if (!slot) return
    const from = labelFor(slot)
    const to = relabel(slot, position)
    if (from !== to) changes.push({ from, to })
  })
  return changes
}

/** Every area whose ordinal changes, in the order they end up sitting. */
function movesTo(face: readonly Slot[], order: readonly number[]): Reordering[] {
  const moves: Reordering[] = []
  order.forEach((id, position) => {
    const slot = face.find((one) => one.area.id === id)
    if (!slot || slot.area.position === position) return
    moves.push({ id, from: slot.area.position, to: position })
  })
  return moves
}

/** The face as `order` leaves it, said both ways. */
function faceChange(face: readonly Slot[], order: number[]): FaceChange {
  return { order, moves: movesTo(face, order), becomes: relabelled(face, order) }
}

/**
 * Where the ordinals go when one area moves to another place on its face.
 *
 * `to` is clamped rather than refused. A move to where the area already is is a
 * change of nothing, and comes back with empty `moves` and `becomes` rather than
 * as a refusal.
 *
 * Returns null when the face has no such area, which is a caller naming an area
 * on a different fixture or one that has been retired.
 */
export function moveArea(face: readonly Slot[], areaId: number, to: number): FaceChange | null {
  const from = face.findIndex((slot) => slot.area.id === areaId)
  if (from === -1) return null

  const landing = Math.max(0, Math.min(face.length - 1, Math.trunc(to)))
  const order = face.map((slot) => slot.area.id)
  order.splice(from, 1)
  order.splice(landing, 0, areaId)

  return faceChange(face, order)
}

/** Where an area lands when it is added to a face at `at`. */
export function addArea(face: readonly Slot[], at: number): number {
  return Math.max(0, Math.min(face.length, Math.trunc(at)))
}

/**
 * Whether the anchors on a face still ascend once the areas sit in `order`.
 *
 * `area.starts_at` is the sort key the run of books in that area begins at, so
 * the anchors of a face read in ordinal order are the places a person walks past
 * in order. Putting `C` before `B` while books stand in both would say the shelf
 * runs backwards, and `areaFor` would answer nonsense about every book between
 * them.
 *
 * Equal anchors are allowed: a boundary move that empties an area leaves two
 * areas anchored at the same key.
 */
export function anchorsAscend(face: readonly Slot[], order: readonly number[]): boolean {
  const anchors = order.map((id) => face.find((slot) => slot.area.id === id)?.area.startsAt ?? '')
  return anchors.every((anchor, at) => at === 0 || anchors[at - 1]! <= anchor)
}

export interface AreaRemoval {
  /** The area whose books take these in, with the label it reads under today. */
  into: { id: number; label: string }
  /** Which way they fell: back into the area before, or forward into the next. */
  joins: 'previous' | 'next'
  /**
   * The anchor the absorbing area has to take over, or null when it keeps its
   * own. Set only when the first area on a face goes, because the area coming
   * forward takes over its place in the sequence and has to open where it
   * opened.
   */
  anchor: string | null
  order: number[]
  moves: Reordering[]
  becomes: LabelChange[]
}

export type Removal =
  | { ok: true; removal: AreaRemoval }
  | { ok: false; error: string }

/**
 * What removing an area from this face would mean. The three shapes are at the
 * top of this file, and the third is the only refusal here: an area with nothing
 * before or after it on its piece has nowhere to put its books.
 */
export function removeArea(face: readonly Slot[], areaId: number): Removal {
  const at = face.findIndex((slot) => slot.area.id === areaId)
  if (at === -1) return { ok: false, error: 'That area is not on this piece of furniture.' }

  const going = face[at]!
  const absorbing = at > 0 ? face[at - 1]! : face[at + 1]
  if (!absorbing) {
    return {
      ok: false,
      error: `Every book sits in an area, and ${labelFor(going)} is the only one on this `
        + 'piece, so there is nothing here for its books to join. Deleting the piece moves '
        + 'them to other furniture instead, and shows you where every one goes first.',
    }
  }

  const order = face.map((slot) => slot.area.id).filter((id) => id !== areaId)
  const change = faceChange(face, order)

  /*
   * The books that read the removed area's label read the absorbing area's,
   * which is a label change like any other and leads `becomes`. It drops out
   * when the two read the same, which is the first-area case: `By the window ·
   * A` goes, `By the window · B` comes forward to `A`, and a book that read `By
   * the window · A` still does.
   */
  const landing = order.indexOf(absorbing.area.id)
  const becomes = [
    { from: labelFor(going), to: relabel(absorbing, landing) },
    ...change.becomes,
  ].filter((one) => one.from !== one.to)

  return {
    ok: true,
    removal: {
      into: { id: absorbing.area.id, label: labelFor(absorbing) },
      joins: at > 0 ? 'previous' : 'next',
      anchor: at > 0 ? null : going.area.startsAt,
      order: change.order,
      moves: change.moves,
      becomes,
    },
  }
}

/**
 * What setting a sort strategy on an area does to the runs.
 *
 * An area with a strategy of its own takes no overflow, because a continuous run
 * only works if every area in it orders the same way, so setting one cuts the
 * run it is in and clearing one joins it back on.
 *
 * `entries` is the set of area ids the placement rules point at, worked out by
 * `rules.ts`. An area a rule names already starts a run, so a strategy on it
 * cuts nothing.
 */
export interface StrategyChange {
  /** Whether the area takes overflow from the area before it afterwards. */
  selfContained: boolean
  /** True when the answer to that question changes, which is what needs saying. */
  cuts: boolean
  /** The areas that leave the run they are in, or rejoin one, this one first. */
  affected: string[]
}

export function strategyChange(
  order: readonly Slot[],
  entries: ReadonlySet<number>,
  areaId: number,
  to: SortStrategy,
): StrategyChange | null {
  const at = order.findIndex((slot) => slot.area.id === areaId)
  if (at === -1) return null

  const slot = order[at]!

  /*
   * The same question `startsARun` answers, asked of a strategy the area does
   * not have yet, by asking it of the slot it would be. A second spelling of
   * where a run is cut would describe a consequence the app will not produce.
   */
  const wouldStart = (one: Slot, strategy: SortStrategy): boolean =>
    startsARun({ ...one, area: { ...one.area, sortStrategy: strategy } }, entries)

  const before = startsARun(slot, entries)
  const after = wouldStart(slot, to)
  const selfContained = after

  // Nothing about the runs changes: either the strategy is not what decides
  // this area's independence, or it did not move.
  if (before === after) return { selfContained, cuts: false, affected: [] }

  // The stretch this area heads either way: itself, and everything after it up
  // to the next area that starts a run on its own account.
  const affected = [slot]
  for (const next of order.slice(at + 1)) {
    if (startsARun(next, entries)) break
    affected.push(next)
  }

  // The first area of the whole collection has nothing before it to take
  // overflow from, so a strategy on it cuts no run in two.
  if (at === 0) return { selfContained, cuts: false, affected: [] }

  return { selfContained, cuts: true, affected: affected.map(labelFor) }
}
