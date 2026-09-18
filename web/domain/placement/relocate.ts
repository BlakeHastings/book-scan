/**
 * Moving a whole run of books onto a different bookcase.
 *
 * There are two ways to say that against this model and they are not the same
 * thing:
 *
 * - Move the fixture. `fixture.position` goes from 4 to 3. Every area keeps its
 *   id, so every book keeps the area it was placed in, and only the label
 *   changes, because a label is derived from the fixture's position at read
 *   time. Nobody carries anything. That is renaming a bookcase, and is not this.
 * - Point the run's rule at a different bookcase, and give that bookcase the
 *   run's own cuts. The areas at the far end are different rows, so the books
 *   stay behind on the planks they are physically on, the rules want them
 *   somewhere else, and the difference is the list of books to carry.
 *
 * Only the second one produces a book in somebody's hands, so it is the one
 * built. See `docs/shelving.md`, "Moving a run to another bookcase".
 *
 * The destination gets the planks the run already had: the same number of areas,
 * anchored at the same sort keys, so capacity does not arise here. A destination
 * that already has planks on it is refused rather than guessed at.
 *
 * Nothing here writes. This is arithmetic over the furniture as it stands, and
 * the plan and the apply are the same answer because they are the same function.
 */

import {
  fixtureLabel, labelFor, runFrom, slotsInOrder, type Area, type Fixture, type Slot,
} from './geography'
import {
  entryAreaOf, entryAreas, nextRunStartAfter, otherRunOn, type PlacementRule,
} from './rules'

/** One plank of the run, said the way somebody reads it off a shelf. */
export interface PlankMove {
  from: string
  to: string
}

/**
 * A piece the move takes every plank off, left standing with nothing on it.
 *
 * A run flows on past the piece its rule points at, so a bookcase somebody put
 * up after it and has not filled yet is the tail of that run. Moving the run
 * takes that bookcase's planks with it and leaves the piece bare, and
 * `docs/shelving.md` requires that a plan which would leave something empty says
 * so before it happens.
 *
 * Nothing is deleted either way: the piece keeps standing and its planks are
 * retired rather than dropped, so moving the run back puts every one of them
 * back on its face.
 *
 * A piece the move cannot take whole is not in here, because it is not touched.
 * A bookcase somebody wrote their own rule on is that rule's furniture and the
 * move stops in front of it.
 */
export interface EmptiedPiece {
  /** What the piece reads as: its name, or its number. */
  name: string
  /** Where it stands, which is what a screen turns into "bookcase 5". */
  position: number
  /** How many planks the move would take off it. */
  planks: number
}

export interface RunRelocation {
  rule: PlacementRule
  /** The bookcase the run starts on now. */
  from: number
  /** The bookcase it would start on. */
  to: number
  /** The furniture as it would stand, with this run's areas hung elsewhere. */
  order: Slot[]
  /** The rules as they would stand, with this one pointing at the new bookcase. */
  rules: PlacementRule[]
  /** Every plank of the run, old label to new. Empty when it is already there. */
  planks: PlankMove[]
  /** Every piece the move would leave with nothing on its face. */
  emptied: EmptiedPiece[]
}

export type Relocation =
  | { ok: true; move: RunRelocation }
  | { ok: false; error: string }

/**
 * Ids for furniture that does not exist yet. Negative, so they cannot collide
 * with a row, and only ever meaningful inside one answer: the plan compares
 * labels rather than ids for exactly this reason, and the apply reads the ids
 * back out of the rows it wrote.
 */
const prospectiveId = (at: number): number => -(at + 1)

/**
 * The run a move would pick up, and where it stands.
 *
 * A run lives where its rule points. The first group of books is wherever the
 * first book happens to be standing, and the two are different answers the
 * moment the leading bookcase of a run holds nothing, which is an ordinary
 * state.
 */
export interface RunOnTheMove {
  rule: PlacementRule
  /** The bookcase the run starts on now. */
  from: number
  /** Every plank the move would rehang, in the order they read. */
  planks: Slot[]
}

/**
 * Whether there is a run here for a move to pick up, said without a
 * destination. A refusal still answers where the run stands wherever it can,
 * because "this cannot be moved" and "this is nowhere" are different sentences.
 */
export type Movable =
  | { ok: true; move: RunOnTheMove }
  | { ok: false; from: number | null; error: string }

/**
 * The run a rule opens, and whether a move may pick it up at all.
 *
 * Every refusal here is about the rule and the furniture and none of them is
 * about the destination, so every one is knowable before anybody has chosen one.
 */
export function runToMove(
  order: Slot[],
  rules: PlacementRule[],
  ruleId: number,
): Movable {
  const rule = rules.find((one) => one.id === ruleId)
  if (!rule) return { ok: false, from: null, error: 'There is no such rule to move.' }

  /*
   * Where the rule points, worked out before anything is refused. A rule a move
   * will not touch still stands somewhere, and that is the sentence "where it
   * lives now" is about.
   */
  const entry = entryAreaOf(rule, order)
  const opening = order.find((slot) => slot.area.id === entry) ?? null

  if (rule.areaId !== null) {
    return {
      ok: false,
      from: opening?.fixture.position ?? null,
      error: `${rule.name} names one plank rather than a bookcase, so there is `
        + 'no run to move.',
    }
  }

  const flowing = entry === null ? [] : runFrom(order, entry, entryAreas(rules, order))
  if (!flowing.length) {
    return {
      ok: false,
      from: opening?.fixture.position ?? null,
      error: `${rule.name} does not point at a bookcase with any planks on it, `
        + 'so there is nothing to move.',
    }
  }

  /*
   * The run flows further than the move may reach. A run runs on until the next
   * rule's entry area, which can fall part way down a piece: somebody puts up a
   * bookcase, gives it four shelves, and writes a rule on the bottom one.
   *
   * A move rehangs whole pieces, so a piece it cannot take whole it does not
   * touch: the stretch that moves stops at the first piece another rule stands
   * on, which is exactly the bound `bandsOf` reconciles over, read from the same
   * function.
   */
  const start = flowing[0]!.fixture.position

  /*
   * And it does not take half of the piece it starts on either.
   * `nextRunStartAfter` answers only about pieces past this one, so the piece a
   * move starts from has to be asked the same question the pieces it stops at
   * are asked: a bookcase another run begins on is that run's furniture.
   * Refused rather than trimmed, because a move that took the planks above the
   * other rule would leave that piece half stripped, which is the state
   * `refuseAHalfStrippedPiece` throws on inside the write.
   */
  const shared = otherRunOn(order, rules, start, flowing[0]!.area.id)
  if (shared) {
    return {
      ok: false,
      from: start,
      error: `${labelFor(shared)} is where something else begins, and a move rehangs `
        + 'whole bookcases rather than half of one. Give that shelf a bookcase of its '
        + 'own first.',
    }
  }

  const limit = nextRunStartAfter(order, rules, start)
  const planks = limit === undefined
    ? flowing
    : flowing.filter((slot) => slot.fixture.position < limit)

  return { ok: true, move: { rule, from: planks[0]!.fixture.position, planks } }
}

/**
 * Where a run would live if its rule pointed at bookcase `to`.
 *
 * Refuses rather than approximating. A destination with planks already on it is
 * two runs sharing a bookcase, which is the arrangement `0013` refuses outright
 * and which nothing here is in a position to merge.
 *
 * What it refuses about the run itself is `runToMove`'s answer, asked here
 * rather than answered a second time, so the screen that asks before offering a
 * destination and the write that asks after one is chosen refuse on the same
 * terms.
 */
export function relocateRun(
  order: Slot[],
  rules: PlacementRule[],
  ruleId: number,
  to: number,
): Relocation {
  /*
   * The destination first, because it is the argument rather than the
   * furniture: a bookcase number that is not one is answered without reading a
   * plank.
   */
  if (!Number.isInteger(to) || to < 1) {
    return { ok: false, error: 'Bookcases are numbered from 1.' }
  }

  const movable = runToMove(order, rules, ruleId)
  if (!movable.ok) return { ok: false, error: movable.error }

  const { rule, from, planks: run } = movable.move
  if (from === to) {
    return { ok: true, move: { rule, from, to, order, rules, planks: [], emptied: [] } }
  }

  const shift = to - from
  const moving = new Set(run.map((slot) => slot.area.id))
  const wanted = new Set(run.map((slot) => slot.fixture.position + shift))

  const occupied = order.find((slot) =>
    !moving.has(slot.area.id) && wanted.has(slot.fixture.position))
  if (occupied) {
    return {
      ok: false,
      error: `Bookcase ${occupied.fixture.position} already has planks on it, `
        + 'and a bookcase holds one run. Move whatever is there first.',
    }
  }

  /*
   * A fixture per destination position, made once and shared by every area
   * landing on it, so the prospective order sorts the way a real one would.
   * Anything the run is not moving keeps the row it has.
   */
  const fixtures = new Map<number, Fixture>()
  for (const position of [...wanted].sort((a, b) => a - b)) {
    fixtures.set(position, {
      id: prospectiveId(fixtures.size),
      position,
      kind: 'bookshelf',
      name: '',
      sortStrategy: 'inherit',
    })
  }

  const rehung: Slot[] = run.map((slot, at) => {
    const fixture = fixtures.get(slot.fixture.position + shift)!
    const area: Area = {
      ...slot.area,
      // A different row, which is the whole point: the books stay on the planks
      // they are on and the rules now want them somewhere else.
      id: prospectiveId(run.length + at),
      fixtureId: fixture.id,
    }
    return { fixture, area }
  })

  const kept = order.filter((slot) => !moving.has(slot.area.id))
  const prospective = slotsInOrder(
    [...new Map([...kept.map((slot) => slot.fixture), ...fixtures.values()]
      .map((fixture) => [fixture.id, fixture])).values()],
    [...kept.map((slot) => slot.area), ...rehung.map((slot) => slot.area)],
  )

  return {
    ok: true,
    move: {
      rule,
      from,
      to,
      order: prospective,
      rules: rules.map((one) => (one.id === rule.id
        ? { ...one, areaId: null, fixtureId: fixtures.get(to)!.id }
        : one)),
      planks: run.map((slot, at) => ({
        from: labelFor(slot),
        to: labelFor(rehung[at]!),
      })),
      emptied: emptiedBy(order, run, moving, wanted),
    },
  }
}

/**
 * The pieces the run would walk off, in the order they stand. A piece is emptied
 * when every plank on it is moving and nothing of the run lands back on it: a
 * run shuffled one bookcase along re-covers most of the furniture it was on, and
 * only the piece at the far end is left bare.
 */
function emptiedBy(
  order: Slot[],
  run: Slot[],
  moving: Set<number>,
  wanted: Set<number>,
): EmptiedPiece[] {
  const staying = new Set(order
    .filter((slot) => !moving.has(slot.area.id))
    .map((slot) => slot.fixture.position))

  const leaving = new Map<number, EmptiedPiece>()
  for (const slot of run) {
    const at = slot.fixture.position
    if (wanted.has(at) || staying.has(at)) continue

    const piece = leaving.get(at)
    if (piece) piece.planks += 1
    else leaving.set(at, { name: fixtureLabel(slot.fixture), position: at, planks: 1 })
  }

  return [...leaving.values()].sort((a, b) => a.position - b.position)
}
