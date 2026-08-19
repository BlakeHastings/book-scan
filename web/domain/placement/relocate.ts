/**
 * Moving a whole run of books onto a different bookcase.
 *
 * The owner's sentence is "non-fiction is on bookcase 4 and I want it on
 * bookcase 3, and then show me every book I have to carry". There are two ways
 * to say that against this model and they are not the same thing:
 *
 * - **Move the fixture.** `fixture.position` goes from 4 to 3. Every area keeps
 *   its id, so every book keeps the area it was placed in, and **the label a
 *   book reads changes with the furniture**, because a label is derived from the
 *   fixture's position at read time. The plan is empty and nobody carries
 *   anything. That is renaming a bookcase, which is a real thing to want and is
 *   not this.
 * - **Point the run's rule at a different bookcase**, and give that bookcase the
 *   run's own cuts. The areas at the far end are different rows, so the books
 *   stay behind on the planks they are physically on, the rules want them
 *   somewhere else, and the difference is the list of books to carry.
 *
 * Only the second one produces a book in somebody's hands, so it is the one
 * built. See `docs/shelving.md`, "Moving a run to another bookcase".
 *
 * ## The run takes its own cuts with it
 *
 * Non-fiction is 8 books, then 20, then 22. Moving it does not ask how many
 * books the destination's planks hold, because the destination gets the planks
 * the run already had: the same number of areas, anchored at the same sort keys,
 * so the same books land together. **Capacity therefore does not arise**, which
 * is the answer this slice can give honestly. What a run does when it is poured
 * onto a bookcase of a different shape is `docs/shelving.md`'s overflow cascade
 * and a question #242 leaves open; a destination that already has planks on it
 * is refused here rather than guessed at.
 *
 * ## Nothing here writes anything
 *
 * This is arithmetic over the furniture as it stands, answering what the
 * furniture would be. The plan reads it and the apply writes it, and they are
 * the same answer because they are the same function.
 */

import {
  fixtureLabel, labelFor, runFrom, slotsInOrder, type Area, type Fixture, type Slot,
} from './geography'
import {
  entryAreaOf, entryAreas, nextRunStartAfter, type PlacementRule,
} from './rules'

/** One plank of the run, said the way somebody reads it off a shelf. */
export interface PlankMove {
  from: string
  to: string
}

/**
 * A piece the move takes every plank off, left standing with nothing on it.
 *
 * **The half of a run move that is about furniture rather than about books**,
 * and #391 is what it cost to leave it unsaid. A run flows on past the piece its
 * rule points at, so a bookcase somebody put up after it and has not filled yet
 * is the tail of that run whether or not they think of it that way. Moving the
 * run therefore takes that bookcase's planks with it and leaves the piece bare,
 * which is a real consequence of a real request and is nobody's surprise to
 * find afterwards. `docs/shelving.md` and #307 say the same thing about removal:
 * a plan that would leave something empty says so before it happens.
 *
 * Nothing is deleted either way. The piece keeps standing and its planks are
 * retired rather than dropped, so moving the run back puts every one of them
 * back on its face.
 *
 * **A piece it cannot take whole is not in here, because it is not touched**
 * (#420). A bookcase somebody wrote their own rule on is that rule's furniture,
 * the move stops in front of it, and a piece that keeps a plank is never left
 * having quietly lost the rest.
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
 * Ids for furniture that does not exist yet.
 *
 * Negative, so they cannot collide with a row, and only ever meaningful inside
 * one answer: the plan compares **labels** rather than ids for exactly this
 * reason, and the apply reads the ids back out of the rows it wrote.
 */
const prospectiveId = (at: number): number => -(at + 1)

/**
 * Where a run would live if its rule pointed at bookcase `to`.
 *
 * Refuses rather than approximating. A destination with planks already on it is
 * two runs sharing a bookcase, which is the arrangement `0013` refuses outright
 * and which nothing here is in a position to merge.
 */
export function relocateRun(
  order: Slot[],
  rules: PlacementRule[],
  ruleId: number,
  to: number,
): Relocation {
  const rule = rules.find((one) => one.id === ruleId)
  if (!rule) return { ok: false, error: 'There is no such rule to move.' }

  if (rule.areaId !== null) {
    return {
      ok: false,
      error: `${rule.name} names one plank rather than a bookcase, so there is `
        + 'no run to move.',
    }
  }

  if (!Number.isInteger(to) || to < 1) {
    return { ok: false, error: 'Bookcases are numbered from 1.' }
  }

  const entry = entryAreaOf(rule, order)
  const flowing = entry === null ? [] : runFrom(order, entry, entryAreas(rules, order))
  if (!flowing.length) {
    return {
      ok: false,
      error: `${rule.name} does not point at a bookcase with any planks on it, `
        + 'so there is nothing to move.',
    }
  }

  /*
   * **The run flows further than the move may reach**, and #420 is the gap
   * between the two. A run runs on until the next rule's entry area, which can
   * fall part way down a piece: somebody puts up a bookcase, gives it four
   * shelves, and writes a rule on the bottom one. The three shelves above it are
   * the tail of this run and the bookcase is not this run's furniture.
   *
   * A move rehangs whole pieces. A piece it cannot take whole it does not touch,
   * because taking three shelves out of somebody's bookcase and screwing them
   * onto another one is not a thing a person asked for and is not a thing the
   * plan could honestly draw. So the stretch that moves stops at the first piece
   * another rule stands on, which is exactly the bound `bandsOf` reconciles
   * over, read from the same function.
   */
  const start = flowing[0]!.fixture.position
  const limit = nextRunStartAfter(order, rules, start)
  const run = limit === undefined
    ? flowing
    : flowing.filter((slot) => slot.fixture.position < limit)

  const from = run[0]!.fixture.position
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
 * The pieces the run would walk off, in the order they stand.
 *
 * A piece is emptied when every plank on it is moving and nothing of the run
 * lands back on it. The second half is what keeps the ordinary case quiet: a run
 * shuffled one bookcase along re-covers most of the furniture it was on, and
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
