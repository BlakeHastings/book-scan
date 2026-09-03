/**
 * Arranging the furniture: what adding, renaming, reordering or removing a
 * piece does to the labels somebody reads off it.
 *
 * Everything here is arithmetic over the areas of **one fixture's face**, in the
 * order they sit on it. Nothing writes, nothing reads a row, and nothing here
 * knows that an ordinal is stored in a column with a unique index on it. That
 * last part is deliberate: the index is a fact about the table and the collision
 * it causes is `infrastructure/shelving/furniture.ts`'s problem, while what a
 * person is agreeing to is this.
 *
 * ## Labels are worked out, here and nowhere else
 *
 * A label is derived from a fixture's position and name and an area's position
 * and name, so **every one of these operations changes labels and none of them
 * changes a book**. Renaming a bookcase relabels every plank on it; moving an
 * area down one relabels it and everything after it. That is why each answer
 * carries `becomes`, which is every label that reads differently afterwards,
 * old to new: it is the only honest way to show somebody what they are about to
 * do, and it is what stops a rename stranding a recorded location nobody can
 * find.
 *
 * ## Removing an area is a merge, and it has three shapes
 *
 * Settled by #281 and drawn in the gallery under `removearea`, `removefirst`
 * and `removeonly`:
 *
 * 1. **Something before it.** Its books join the area before it, which keeps its
 *    own anchor, and nothing else on the face moves.
 * 2. **Nothing before it.** The first area on a piece has nothing behind it to
 *    fall into, so the area after it comes forward and the whole run of labels
 *    shuffles up. The area coming forward **takes over the removed one's
 *    anchor**, because it takes over its place in the sequence: opening where
 *    the removed area opened is what makes those books fall into it.
 * 3. **Nothing before or after it.** A piece with one area has nowhere on it for
 *    those books, so this refuses rather than promising something impossible.
 *    The way out is deleting the piece, which is a real carry and lands on a
 *    plan.
 *
 * **No book is deleted and no placement is**, in any of the three. What the
 * removal does to the ledger is `server/furniture.ts`'s job, and it is #185's
 * rule: an `assigned` row where the answer differs from where the book is.
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
 * What a change to one fixture's face comes to.
 *
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
 *
 * An area whose ordinal does not change is not listed, and neither is a named
 * one that merely shuffled: `2 · Cookery` reads the same wherever it sits,
 * because a name is what a person chose and a letter is what the position
 * happens to be.
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
 * `to` is clamped rather than refused, because a screen that has just watched
 * somebody drag a row to the bottom of a list should not have to know how many
 * rows there were. A move to where the area already is is a change of nothing,
 * and comes back with empty `moves` and `becomes` rather than as a refusal.
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
 * in order. Putting `C` before `B` while books stand in both would say the
 * shelf runs backwards, and `areaFor` would answer nonsense about every book
 * between them.
 *
 * Equal anchors are allowed and are not a curiosity: a boundary move that
 * empties an area leaves two areas anchored at the same key, and that state is
 * real in this catalogue today.
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
   * own.
   *
   * Set only when the first area on a face goes, because the area coming forward
   * is taking over its place in the sequence and has to open where it opened.
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
 * What removing an area from this face would mean.
 *
 * The three shapes are at the top of this file. The refusal is the third one and
 * it is the only place here that refuses: an area with nothing before or after
 * it on its piece has nowhere to put its books, and a dialog that offered to do
 * it anyway would be promising to lose them.
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
   * The books that read the removed area's label read the absorbing area's, and
   * that is a label change like any other: it belongs in `becomes` beside the
   * shuffle, in front of it, because it is the one the dialog leads on.
   *
   * It drops out when the two read the same, which is exactly the first-area
   * case: `By the window · A` goes, `By the window · B` comes forward to `A`,
   * and a book that read `By the window · A` still does.
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
 * **An area with a strategy of its own takes no overflow**, because a continuous
 * run only works if every area in it orders the same way, so setting one cuts
 * the run it is in and clearing one joins it back on. Neither is a thing to do
 * quietly: the areas after it stop being fed by the area before, which is a
 * different set of books arriving at every plank from there to the end of the
 * run.
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
   * not have yet, by asking it of the slot it would be.
   *
   * That is the whole reason this could not simply call it, and it is not a
   * reason to answer it again: this dialog is the promise the rest of the app
   * keeps about a self-ordering plank, so a second spelling of where a run is
   * cut here would be the app describing a consequence it will not produce.
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
