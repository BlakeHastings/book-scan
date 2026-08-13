/**
 * Describing the furniture: adding a piece, naming it, cutting it into areas,
 * reordering them, and taking one away.
 *
 * The tables have been here since #184 and nothing could touch them. This is the
 * API the owner asked for first, in his words: getting the fixture system
 * working so he can model the furniture he actually owns and then move the
 * non-fiction out of the living room. **There is no screen here on purpose**;
 * the screens are drawn in the gallery and are somebody else's issue.
 *
 * ## Every answer carries the labels it changes
 *
 * A label is derived at read time from a fixture's number and name and an area's
 * ordinal and name, and is stored nowhere. So renaming a bookcase relabels every
 * plank on it and reordering its areas relabels the ones that shuffled, and
 * neither moves a book. Each write here answers with `becomes`, every label that
 * reads differently afterwards, old to new. That is what a rename owes: the
 * recorded location of a book is an area row rather than a string, so nothing is
 * stranded, and `becomes` is how somebody sees that for themselves rather than
 * being told.
 *
 * ## Removing an area is a merge, and it writes assignments
 *
 * `domain/placement/arrangement.ts` works out which area takes the books in.
 * What happens to those books is #185's rule and nothing else: an `assigned` row
 * naming the area that absorbed them, written only where that differs from where
 * the book already is. **No placement is deleted and no book is.** The removed
 * area is retired rather than dropped whenever anything names it, so a book
 * recorded on `2C` is still recorded on `2C`, and the difference between what
 * the rules now want and where somebody last saw it is exactly the
 * needs-attention list this app already keeps.
 *
 * **`pinned` beats every rule, forever.** A pinned book is left alone by all of
 * this, and every answer says how many it left alone rather than quietly
 * counting them among the ones that moved.
 *
 * ### Why an assignment and not a placement
 *
 * The tempting alternative is to write `placed` rows, on the reasoning that the
 * books physically did not move and the area they are standing in is now the one
 * next door, so the count on that area ought to go up straight away. It is not
 * this API's to write. **`PATCH /api/books/:id/location` is the only route that
 * changes where the catalogue thinks a book is**, which is the same rule
 * `Shelves.moveAcrossBoundary` keeps when it moves a boundary under a book, and
 * it is what stops the app claiming somebody said something they did not. So the
 * removal records where the books belong and a person confirms where they are,
 * exactly as a boundary move already does.
 *
 * ## `pinned` is why a placement would be wrong as well as unearned
 *
 * A `placed` row clears the pin, because a person putting a book somewhere is a
 * later decision than pinning it there. Writing one per book on a merge would
 * therefore silently unpin every pinned book in the area, which is the one thing
 * this model promises cannot happen.
 */

import {
  fixtureLabel, labelFor, type Area, type Fixture, type Slot,
} from '../domain/placement/geography'
import {
  addArea as landingFor, anchorsAscend, moveArea, removeArea, strategyChange,
  type LabelChange, type StrategyChange,
} from '../domain/placement/arrangement'
import { assignmentFor, standingOf, type Placement } from '../domain/placement/ledger'
import { entryAreas } from '../domain/placement/rules'
import {
  INHERIT, SORT_STRATEGIES, strategyFor, type OrderingStrategy, type SortStrategy,
} from '../domain/placement/strategies'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { furnitureIn, retireOrRemove } from '../infrastructure/shelving/areas'
import {
  areaOnAFace, areasOnFaces, booksNaming, collectionId, collectionStrategy,
  fixtureOnTheFloor, fixturesOnTheFloor, insertArea, insertFixture, nextFixturePosition,
  offerableStrategies, removeFixtureIfUnused, resequenceFace, updateArea, updateFixture,
  whatHoldsFixture, type AreaRow, type FixtureRow,
} from '../infrastructure/shelving/furniture'
import type { Db } from './driver'

/**
 * A refusal, with the status it deserves.
 *
 * 409 rather than 400 wherever the request was well formed and the furniture
 * was not in a state to take it, which is every refusal here that a person can
 * do something about: removing the only area on a piece, or changing a strategy
 * without having been shown what it does.
 */
export interface Refused {
  ok: false
  status: number
  error: string
  /** What the caller has to show somebody before asking again. */
  effect?: unknown
}

const refuse = (status: number, error: string, effect?: unknown): Refused =>
  ({ ok: false, status, error, ...(effect === undefined ? {} : { effect }) })

/** The lock every write here takes, so two people rearranging one room queue. */
export const FURNITURE_LOCK = 'furniture'

// ---------------------------------------------------------------------------
// Reading the room
// ---------------------------------------------------------------------------

const asFixture = (row: FixtureRow): Fixture => ({
  id: row.id,
  position: row.position,
  kind: row.kind,
  name: row.name,
  sortStrategy: row.sortStrategy,
})

const asArea = (row: AreaRow): Area => ({
  id: row.id,
  fixtureId: row.fixtureId,
  position: row.position,
  name: row.name,
  startsAt: row.startsAt,
  sortStrategy: row.sortStrategy,
})

/** One area as the wire says it. `label` is worked out, never stored. */
export interface DescribedArea {
  id: number
  position: number
  label: string
  name: string
  startsAt: string
  sortStrategy: SortStrategy
  /** What it is actually ordered by, folded through the fixture and collection. */
  ordering: OrderingStrategy
  /** Anything but `inherit` means it takes no overflow from the area before. */
  selfContained: boolean
  note: string
  books: number
}

export interface DescribedFixture {
  id: number
  position: number
  label: string
  kind: string
  name: string
  sortStrategy: SortStrategy
  note: string
  books: number
  areas: DescribedArea[]
  /** The other pieces standing on this piece's number, if any. See below. */
  sharing: number[]
}

export interface DescribedFurniture {
  fixtures: DescribedFixture[]
  defaultSortStrategy: SortStrategy
  strategies: { code: SortStrategy; label: string; isInherit: boolean }[]
}

/**
 * The whole room, in the order a book meets it.
 *
 * `sharing` is the honest half of `fixture.position` not being unique. Two
 * pieces on one number is an arrangement this catalogue already has and must
 * keep being able to record, and it is also two pieces drawing planks with the
 * same label, so a screen that did not know would show one twice with no
 * explanation.
 */
export async function describeFurniture(db: Db): Promise<DescribedFurniture> {
  const [fixtures, areas, fallback, strategies] = await Promise.all([
    fixturesOnTheFloor(db), areasOnFaces(db), collectionStrategy(db), offerableStrategies(db),
  ])

  const collection = (fallback === INHERIT ? 'author' : fallback) as OrderingStrategy

  return {
    fixtures: fixtures.map((fixture) => {
      const own = areas.filter((one) => one.fixtureId === fixture.id)
      return {
        id: fixture.id,
        position: fixture.position,
        label: fixtureLabel(asFixture(fixture)),
        kind: fixture.kind,
        name: fixture.name,
        sortStrategy: fixture.sortStrategy,
        note: fixture.note,
        books: own.reduce((total, one) => total + one.books, 0),
        areas: own.map((area) => ({
          id: area.id,
          position: area.position,
          label: labelFor({ fixture: asFixture(fixture), area: asArea(area) }),
          name: area.name,
          startsAt: area.startsAt,
          sortStrategy: area.sortStrategy,
          ordering: strategyFor(collection, fixture.sortStrategy, area.sortStrategy),
          selfContained: area.sortStrategy !== INHERIT,
          note: area.note,
          books: area.books,
        })),
        sharing: fixtures
          .filter((one) => one.id !== fixture.id && one.position === fixture.position)
          .map((one) => one.id),
      }
    }),
    defaultSortStrategy: fallback,
    strategies,
  }
}

/** One piece, or nothing. */
export async function describeFixture(
  db: Db,
  id: number,
): Promise<DescribedFixture | null> {
  return (await describeFurniture(db)).fixtures.find((one) => one.id === id) ?? null
}

/** The areas of one fixture as slots, in the order they sit on its face. */
async function faceOf(db: Db, fixture: FixtureRow): Promise<Slot[]> {
  const areas = await areasOnFaces(db)
  return areas
    .filter((area) => area.fixtureId === fixture.id)
    .sort((a, b) => a.position - b.position)
    .map((area) => ({ fixture: asFixture(fixture), area: asArea(area) }))
}

/**
 * Every label that reads differently once the face is `after` and the areas sit
 * in `order`.
 *
 * One function for all four ways a label can change, because to a person they
 * are one thing: renaming the piece, renumbering it, renaming an area and moving
 * an area along the piece all end in somebody looking for a book under a
 * different name. An area that is being added has no old label and is left out.
 */
function relabelling(
  before: readonly Slot[],
  after: readonly Slot[],
  order: readonly number[],
): LabelChange[] {
  const was = new Map(before.map((slot) => [slot.area.id, labelFor(slot)]))
  const changes: LabelChange[] = []
  order.forEach((id, position) => {
    const slot = after.find((one) => one.area.id === id)
    const from = was.get(id)
    if (!slot || from === undefined) return
    const to = labelFor({ fixture: slot.fixture, area: { ...slot.area, position } })
    if (from !== to) changes.push({ from, to })
  })
  return changes
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** What a caller may say about a piece of furniture. */
export interface FixtureInput {
  kind?: unknown
  name?: unknown
  position?: unknown
  sortStrategy?: unknown
  note?: unknown
}

const asText = (value: unknown): string | undefined =>
  (value === undefined ? undefined : String(value ?? '').trim())

const asStrategy = (value: unknown): SortStrategy | undefined | null => {
  if (value === undefined) return undefined
  const code = String(value ?? '')
  return (SORT_STRATEGIES as readonly string[]).includes(code) ? code as SortStrategy : null
}

const asPosition = (value: unknown): number | undefined | null => {
  if (value === undefined) return undefined
  const position = Number(value)
  return Number.isInteger(position) ? position : null
}

export type AddedFixture = { ok: true; fixture: DescribedFixture } | Refused

/**
 * Put a piece of furniture in the room.
 *
 * It arrives with no areas, because an area is a decision about where one run of
 * books stops and the next begins, and a piece somebody has only just named has
 * no books on it to cut. `POST /api/fixtures/:id/areas` is the next thing they
 * do, as many times as the piece has planks.
 *
 * The number defaults to one past the last piece, which is where somebody
 * describing their furniture in the order they walk past it wants it.
 */
export async function addFixture(db: Db, input: FixtureInput): Promise<AddedFixture> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const position = asPosition(input.position)
  if (position === null || (position !== undefined && position < 1)) {
    return refuse(400, 'Pieces of furniture are numbered from 1.')
  }

  return db.tx(async (tx) => {
    const collection = await collectionId(tx)
    if (!collection) return refuse(500, 'This catalogue has no collection to hang furniture on.')

    const id = await insertFixture(tx, {
      collectionId: collection,
      kind: asText(input.kind) || 'bookshelf',
      name: asText(input.name) ?? '',
      position: position ?? await nextFixturePosition(tx),
      sortStrategy: strategy ?? INHERIT,
      note: asText(input.note) ?? '',
    })

    const fixture = await describeFixture(tx, id)
    return fixture ? { ok: true as const, fixture } : refuse(500, 'The piece was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

export type EditedFixture =
  | { ok: true; fixture: DescribedFixture; becomes: LabelChange[] }
  | Refused

/**
 * Rename a piece, renumber it, say what kind of thing it is, or change how it
 * orders what it holds.
 *
 * **Renumbering a piece is renaming it, and it moves nothing.** Every area keeps
 * its id, so every book keeps the area it was placed in and its recorded
 * location follows the furniture: what changes is the label, which is derived
 * from the number. Pointing a run at a different piece is the other thing, it is
 * the one that produces books in somebody's hands, and it lives in
 * `relocate-run.ts`. See `domain/placement/relocate.ts` for why the two are not
 * the same request.
 *
 * `becomes` is therefore the whole answer: every label on the piece that reads
 * differently now.
 */
export async function editFixture(
  db: Db,
  id: number,
  input: FixtureInput,
): Promise<EditedFixture> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const position = asPosition(input.position)
  if (position === null || (position !== undefined && position < 1)) {
    return refuse(400, 'Pieces of furniture are numbered from 1.')
  }

  return db.tx(async (tx) => {
    const before = await fixtureOnTheFloor(tx, id)
    if (!before) return refuse(404, 'No such piece of furniture.')

    const name = asText(input.name)
    const after: Fixture = {
      ...asFixture(before),
      name: name ?? before.name,
      position: position ?? before.position,
    }

    const face = await faceOf(tx, before)
    const becomes = relabelling(
      face,
      face.map((slot) => ({ fixture: after, area: slot.area })),
      face.map((slot) => slot.area.id),
    )

    await updateFixture(tx, id, {
      kind: asText(input.kind),
      name,
      position,
      sortStrategy: strategy,
      note: asText(input.note),
    })

    const fixture = await describeFixture(tx, id)
    return fixture
      ? { ok: true as const, fixture, becomes }
      : refuse(500, 'The piece was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

export interface FixtureRemoval {
  /** How many books are standing on it, which is what has to leave first. */
  books: number
  areas: number
  /** How many placement rules point at it or at one of its areas. */
  rules: number
  /**
   * Whether the row will stay behind with nothing on its face.
   *
   * A piece whose areas a book was ever placed in cannot be deleted:
   * `book_placement.area_id` is ON DELETE RESTRICT so the history pins the
   * furniture it names, and a plank a book once sat on stays nameable. Such a
   * piece is taken off the floor rather than out of the catalogue, which is the
   * same answer an area gets, and saying so beats a delete that quietly did
   * something else.
   */
  retires: boolean
}

export type RemovedFixture = { ok: true; removed: FixtureRemoval } | Refused

/** What taking this piece away would mean, without taking it away. */
export async function planFixtureRemoval(
  db: Db,
  id: number,
): Promise<{ ok: true; removal: FixtureRemoval } | Refused> {
  const fixture = await fixtureOnTheFloor(db, id)
  if (!fixture) return refuse(404, 'No such piece of furniture.')
  return { ok: true, removal: await whatHoldsFixture(db, id) }
}

/**
 * Take a piece of furniture away, once nothing is standing on it.
 *
 * **It refuses while it still holds books**, and says how many, which is the
 * sentence the furniture screen already says: its books move to other furniture
 * first, and that is a real carry with a plan in front of it. Emptying a piece
 * by deleting it would either lose the books or leave them recorded on planks
 * nobody can walk to, and neither is something to do behind a person's back.
 *
 * A piece a placement rule points at is refused for the same reason: the rule
 * files books there, and deleting the furniture out from under it would leave
 * the rule pointing nowhere and its books unplaceable.
 */
export async function dropFixture(db: Db, id: number): Promise<RemovedFixture> {
  return db.tx(async (tx) => {
    const fixture = await fixtureOnTheFloor(tx, id)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    const holds = await whatHoldsFixture(tx, id)
    if (holds.books) {
      return refuse(
        409,
        `Its ${holds.books} book${holds.books === 1 ? '' : 's'} move to other furniture first.`,
        holds,
      )
    }
    if (holds.rules) {
      return refuse(
        409,
        `${holds.rules} rule${holds.rules === 1 ? '' : 's'} still file books here. `
          + 'Point them somewhere else first.',
        holds,
      )
    }

    // The areas go before the piece can, and one a book was ever placed in
    // cannot go at all. Such a piece keeps standing with nothing on its face,
    // which is `retires` and is reported rather than treated as a failure: the
    // piece is off the floor either way, and the history it carries is the
    // reason the row survives.
    for (const slot of await faceOf(tx, fixture)) {
      await retireOrRemove(tx, slot.area.id, slot.area.position)
    }

    const gone = await removeFixtureIfUnused(tx, id)
    return { ok: true as const, removed: { ...holds, retires: !gone } }
  }, { serialiseOn: FURNITURE_LOCK })
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export interface AreaInput {
  name?: unknown
  startsAt?: unknown
  sortStrategy?: unknown
  note?: unknown
  position?: unknown
  /** Set once somebody has been shown what a strategy change does to the runs. */
  acknowledge?: unknown
}

export type AddedArea =
  | { ok: true; area: DescribedArea; becomes: LabelChange[] }
  | Refused

const ANCHORS_OUT_OF_ORDER =
  'The areas on a piece are read in the order the books run along it, so an area '
  + 'cannot start before the one in front of it. Move the boundary instead of the area.'

/**
 * Cut another area into a piece of furniture.
 *
 * `startsAt` is the sort key the run of books in it begins at, which is what a
 * boundary is: everything from there to the next boundary is one area. Left out,
 * the area opens at the empty string, which is how "from the beginning" is said
 * without a null and is right for the first area of a run.
 *
 * `position` puts it between two areas that already exist; left out it goes on
 * the end. Everything after it shuffles down, which relabels those areas and
 * moves no book, and `becomes` says which.
 */
export async function addAreaTo(
  db: Db,
  fixtureId: number,
  input: AreaInput,
): Promise<AddedArea> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const at = asPosition(input.position)
  if (at === null || (at !== undefined && at < 0)) {
    return refuse(400, 'Areas are numbered from 0, which is the one at the top.')
  }

  return db.tx(async (tx) => {
    const fixture = await fixtureOnTheFloor(tx, fixtureId)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    const face = await faceOf(tx, fixture)
    const landing = landingFor(face, at ?? face.length)

    const wanted: Area = {
      // A stand-in, checked against the anchors before anything is written. Zero
      // cannot collide with a row: the identity column starts at 1.
      id: 0,
      fixtureId,
      position: landing,
      name: asText(input.name) ?? '',
      startsAt: asText(input.startsAt) ?? '',
      sortStrategy: strategy ?? INHERIT,
    }
    const grown: Slot[] = [...face, { fixture: asFixture(fixture), area: wanted }]
    const order: number[] = face.map((slot) => slot.area.id)
    order.splice(landing, 0, 0)

    // Refused before the insert, so a refusal writes nothing. Returning one out
    // of a transaction commits it, which is right for a read-only refusal and
    // would be a half-made area if the row already existed.
    if (!anchorsAscend(grown, order)) return refuse(409, ANCHORS_OUT_OF_ORDER)

    /*
     * Written on the end and then renumbered, rather than inserted at the
     * ordinal it wants. The unique index would refuse the insert while the area
     * already sitting there still holds the number, and the renumbering is
     * needed anyway for everything after it. See `resequenceFace`.
     */
    const id = await insertArea(tx, {
      fixtureId,
      position: face.length,
      name: wanted.name,
      startsAt: wanted.startsAt,
      sortStrategy: wanted.sortStrategy,
      note: asText(input.note) ?? '',
    })

    const becomes = relabelling(face, face, order.map((one) => (one === 0 ? id : one)))
    await resequenceFace(tx, fixtureId, order.map((one) => (one === 0 ? id : one)))

    const area = (await describeFixture(tx, fixtureId))?.areas.find((one) => one.id === id)
    return area
      ? { ok: true as const, area, becomes }
      : refuse(500, 'The area was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

export type EditedArea =
  | { ok: true; area: DescribedArea; becomes: LabelChange[]; effect: StrategyChange | null }
  | Refused

/**
 * Rename an area, move it along its piece, re-anchor it, or give it an order of
 * its own.
 *
 * ## The strategy is the one that is not just a label change
 *
 * **An area with a sort strategy of its own takes no overflow**, because a
 * continuous run only works if every area in it orders the same way. Setting one
 * therefore cuts the run the area is in, and the areas from there on stop being
 * fed by the ones before them. That is not something to do quietly, so it is
 * refused with the effect attached until the caller says `acknowledge`, and the
 * effect is what a dialog shows somebody before they agree.
 *
 * ## Reordering
 *
 * Moving an area along its piece renumbers everything between where it was and
 * where it is going, which is `resequenceFace`'s two passes and the reason they
 * exist. It is refused when it would leave the anchors on the face out of order,
 * because the areas of a piece are read in the order the books run along it and
 * an area cannot begin before the one in front of it.
 */
export async function editArea(db: Db, id: number, input: AreaInput): Promise<EditedArea> {
  const strategy = asStrategy(input.sortStrategy)
  if (strategy === null) return refuse(400, 'That is not a way of ordering a shelf.')

  const at = asPosition(input.position)
  if (at === null || (at !== undefined && at < 0)) {
    return refuse(400, 'Areas are numbered from 0, which is the one at the top.')
  }

  return db.tx(async (tx) => {
    const area = await areaOnAFace(tx, id)
    if (!area) return refuse(404, 'No such area.')

    const fixture = await fixtureOnTheFloor(tx, area.fixtureId)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    let effect: StrategyChange | null = null
    if (strategy !== undefined && strategy !== area.sortStrategy) {
      const { order, rules } = await furnitureIn(tx)
      effect = strategyChange(order, entryAreas(rules, order), id, strategy)
      if (effect?.cuts && input.acknowledge !== true) {
        return refuse(
          409,
          effect.selfContained
            ? `${effect.affected[0]} would order itself, so nothing overflows into it from `
              + `the area before and ${effect.affected.length} area`
              + `${effect.affected.length === 1 ? '' : 's'} leave the run they are in.`
            : `${effect.affected[0]} would go back to ordering the way the run does, and `
              + `${effect.affected.length} area${effect.affected.length === 1 ? '' : 's'} `
              + 'rejoin the run before it.',
          effect,
        )
      }
    }

    const face = await faceOf(tx, fixture)
    const name = asText(input.name)
    const startsAt = asText(input.startsAt)

    // The face as it will read, so `becomes` and the anchor check both answer
    // about the arrangement being asked for rather than the one standing.
    const restated: Slot[] = face.map((slot) => (slot.area.id === id
      ? {
          fixture: slot.fixture,
          area: {
            ...slot.area,
            name: name ?? slot.area.name,
            startsAt: startsAt ?? slot.area.startsAt,
          },
        }
      : slot))

    const change = at === undefined ? null : moveArea(restated, id, at)
    const order = change?.order ?? restated.map((slot) => slot.area.id)
    if (!anchorsAscend(restated, order)) return refuse(409, ANCHORS_OUT_OF_ORDER)

    const becomes = relabelling(face, restated, order)

    await updateArea(tx, id, {
      name,
      startsAt,
      sortStrategy: strategy,
      note: asText(input.note),
    })
    if (change?.moves.length) await resequenceFace(tx, area.fixtureId, order)

    const described = (await describeFixture(tx, area.fixtureId))
      ?.areas.find((one) => one.id === id)
    return described
      ? { ok: true as const, area: described, becomes, effect }
      : refuse(500, 'The area was not written.')
  }, { serialiseOn: FURNITURE_LOCK })
}

/** What happens to the books of an area somebody is about to remove. */
export interface AreaRemovalPlan {
  area: { id: number; label: string; books: number }
  /** The area they join, with the label it reads under today. */
  into: { id: number; label: string }
  joins: 'previous' | 'next'
  /** How many books join it, which is the number the dialog leads on. */
  joining: number
  /** Everything left exactly where it is, and why. Never silently empty. */
  skipped: { reason: 'pinned' | 'checked-out' | 'withdrawn'; books: number }[]
  /** Every label that reads differently afterwards, old to new. */
  becomes: LabelChange[]
}

export type PlannedAreaRemoval = { ok: true; plan: AreaRemovalPlan } | Refused

const SKIP_ORDER = ['pinned', 'checked-out', 'withdrawn'] as const

type SkipReason = (typeof SKIP_ORDER)[number]

/** Which books move, which stay, and why: the same fold the write path makes. */
function foldForRemoval(
  books: readonly number[],
  rows: readonly Placement[],
  from: number,
  into: number,
): { moving: { id: number; to: number }[]; skipped: Map<SkipReason, number> } {
  const history = new Map<number, Placement[]>()
  for (const row of rows) {
    const existing = history.get(row.bookId)
    if (existing) existing.push(row)
    else history.set(row.bookId, [row])
  }

  const moving: { id: number; to: number }[] = []
  const skipped = new Map<SkipReason, number>()
  const skip = (reason: SkipReason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)

  for (const id of books) {
    const standing = standingOf(history.get(id) ?? [])
    // Only a book this area is still about. The rest merely have it in their
    // history, which is a plank they were on once and is not a reason to move
    // anything.
    if (standing.area !== from && standing.assigned !== from) continue

    if (standing.pinned) { skip('pinned'); continue }
    if (standing.checkedOut) { skip('checked-out'); continue }
    if (standing.withdrawn) { skip('withdrawn'); continue }

    const wanted = assignmentFor(standing, into)
    if (wanted !== null) moving.push({ id, to: wanted })
  }

  return { moving, skipped }
}

const skippedList = (skipped: Map<SkipReason, number>) =>
  SKIP_ORDER
    .filter((reason) => skipped.has(reason))
    .map((reason) => ({ reason, books: skipped.get(reason)! }))

/**
 * What removing this area would do, before anybody agrees to it. Writes nothing.
 *
 * This is what the dialog #281 settled is drawn from, and the same functions the
 * write path uses answer it, so what somebody approves is what happens.
 */
export async function planAreaRemoval(db: Db, id: number): Promise<PlannedAreaRemoval> {
  const area = await areaOnAFace(db, id)
  if (!area) return refuse(404, 'No such area.')

  const fixture = await fixtureOnTheFloor(db, area.fixtureId)
  if (!fixture) return refuse(404, 'No such piece of furniture.')

  const face = await faceOf(db, fixture)
  const removal = removeArea(face, id)
  if (!removal.ok) return refuse(409, removal.error)

  const books = await booksNaming(db, id)
  const rows = await new DrizzlePlacementLedger(db).forBooks(books)
  const { moving, skipped } = foldForRemoval(books, rows, id, removal.removal.into.id)

  return {
    ok: true,
    plan: {
      area: {
        id,
        label: labelFor(face.find((slot) => slot.area.id === id)!),
        books: area.books,
      },
      into: removal.removal.into,
      joins: removal.removal.joins,
      joining: moving.length,
      skipped: skippedList(skipped),
      becomes: removal.removal.becomes,
    },
  }
}

export type RemovedArea = { ok: true; plan: AreaRemovalPlan } | Refused

/**
 * Take an area off a piece of furniture and let its books fall into the next
 * one along.
 *
 * Four things happen, in this order, in one transaction:
 *
 * 1. When the area going is the first on its piece, the one coming forward takes
 *    over its anchor, because it is taking over its place in the sequence.
 * 2. The area is **retired** rather than deleted whenever anything names it, so
 *    every placement that points at it still points at it and a book recorded on
 *    that plank is still recorded on that plank. Nothing names it, it goes.
 * 3. The face is renumbered, which relabels the areas after it.
 * 4. An `assigned` row is written for every book the area was about, naming the
 *    area that took them in, and **only where that differs from where the book
 *    already is**. Pinned, checked out and withdrawn books get none, and the
 *    answer says how many there were.
 *
 * The books have not moved and nobody has carried anything. What has changed is
 * which area the rules say they are in, and the difference between that and
 * where somebody last saw them is the needs-attention list that already exists.
 */
export async function dropArea(db: Db, id: number, now: string): Promise<RemovedArea> {
  return db.tx(async (tx) => {
    const planned = await planAreaRemoval(tx, id)
    if (!planned.ok) return planned

    const area = await areaOnAFace(tx, id)
    if (!area) return refuse(404, 'No such area.')

    const fixture = await fixtureOnTheFloor(tx, area.fixtureId)
    if (!fixture) return refuse(404, 'No such piece of furniture.')

    const face = await faceOf(tx, fixture)
    const removal = removeArea(face, id)
    if (!removal.ok) return refuse(409, removal.error)

    if (removal.removal.anchor !== null) {
      await updateArea(tx, removal.removal.into.id, { startsAt: removal.removal.anchor })
    }

    await retireOrRemove(tx, id, area.position)
    await resequenceFace(tx, area.fixtureId, removal.removal.order)

    const books = await booksNaming(tx, id)
    const ledger = new DrizzlePlacementLedger(tx)
    const { moving } = foldForRemoval(
      books, await ledger.forBooks(books), id, removal.removal.into.id,
    )

    const keys = new Map((await tx.all<{ id: number; sort_key: string }>(
      `SELECT id, sort_key FROM books WHERE id IN (${books.map(() => '?').join(', ') || 'NULL'})`,
      books,
    )).map((row) => [Number(row.id), row.sort_key]))

    for (const book of moving) {
      await ledger.record({
        bookId: book.id,
        kind: 'assigned',
        areaId: book.to,
        sortKey: keys.get(book.id) ?? '',
        actor: 'rules',
        reason: `${planned.plan.area.label} was removed`,
        createdAt: now,
      })
    }

    return { ok: true as const, plan: planned.plan }
  }, { serialiseOn: FURNITURE_LOCK })
}
