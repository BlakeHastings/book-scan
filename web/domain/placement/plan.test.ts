import { describe, expect, it } from 'vitest'
import { labelFor, slotsInOrder, type Area, type Fixture, type Slot } from './geography'
import type { Placement, PlacementKind } from './ledger'
import { planPlacements, type PlannableBook } from './plan'
import { relocateRun } from './relocate'
import type { PlacementRule } from './rules'
import { INHERIT } from './strategies'

const fixture = (id: number, position: number): Fixture =>
  ({ id, position, kind: 'bookshelf', name: '', sortStrategy: INHERIT })

const area = (id: number, fixtureId: number, position: number, startsAt = ''): Area =>
  ({ id, fixtureId, position, name: '', startsAt, sortStrategy: INHERIT })

const onTag = (id: number, value: string, fixtureId: number): PlacementRule => ({
  id,
  areaId: null,
  fixtureId,
  priority: id,
  name: value,
  enabled: true,
  conditions: [{ field: 'tag', operator: 'is', value }],
})

const RULES = [onTag(1, 'genre/fiction', 1), onTag(2, 'genre/non-fiction', 4)]

const ORDER = slotsInOrder(
  [fixture(1, 1), fixture(4, 4)],
  [area(10, 1, 0), area(40, 4, 0), area(41, 4, 1, 'K'), area(42, 4, 2, 'S')],
)

const LABELS = (order: Slot[]) => new Map(order.map((slot) => [slot.area.id, labelFor(slot)]))

let nextRow = 0

const row = (bookId: number, kind: PlacementKind, areaId: number | null): Placement => ({
  id: (nextRow += 1),
  bookId,
  kind,
  areaId,
  sortKey: '',
  ruleId: null,
  actor: 'person',
  reason: '',
  createdAt: '2026-08-11T00:00:00.000Z',
})

const book = (id: number, sortKey: string, tag = 'genre/non-fiction'): PlannableBook =>
  ({ id, title: `Book ${id}`, authorFiling: `Author, ${id}`, sortKey, tagSlugs: [tag] })

/** Non-fiction: three books, one on each plank of bookcase 4. */
const NON_FICTION = [book(1, 'A'), book(2, 'L'), book(3, 'T')]
const PLACED = [row(1, 'placed', 40), row(2, 'placed', 41), row(3, 'placed', 42)]

function movedToThree() {
  const moved = relocateRun(ORDER, RULES, 2, 3)
  if (!moved.ok) throw new Error(moved.error)
  return moved.move
}

describe('planning a run onto another bookcase', () => {
  it('names every book to carry, grouped by the two planks the move names', () => {
    const move = movedToThree()
    const plan = planPlacements(NON_FICTION, PLACED, move.rules, move.order, LABELS(ORDER))

    expect(plan.moving).toBe(3)
    expect(plan.staying).toBe(0)
    expect(plan.groups).toEqual([
      { from: '4A', to: '3A', books: [{ id: 1, title: 'Book 1', authorFiling: 'Author, 1' }] },
      { from: '4B', to: '3B', books: [{ id: 2, title: 'Book 2', authorFiling: 'Author, 2' }] },
      { from: '4C', to: '3C', books: [{ id: 3, title: 'Book 3', authorFiling: 'Author, 3' }] },
    ])
  })

  it('writes nothing, which is the point: the rows it was handed come back unchanged', () => {
    const move = movedToThree()
    const before = JSON.stringify(PLACED)
    planPlacements(NON_FICTION, PLACED, move.rules, move.order, LABELS(ORDER))
    expect(JSON.stringify(PLACED)).toBe(before)
  })

  it('says how many books it skipped and why, rather than dropping them', () => {
    /*
     * The failure this exists to prevent: a plan saying "3 books move" having
     * quietly left a pinned one out. A pin beats every rule forever, so the book
     * is not moving, and a person reading a count has to be told.
     */
    const pinned = [...PLACED, row(2, 'pinned', 41)]
    const move = movedToThree()
    const plan = planPlacements(NON_FICTION, pinned, move.rules, move.order, LABELS(ORDER))

    expect(plan.moving).toBe(2)
    expect(plan.skipped).toEqual([
      { reason: 'pinned', books: [{ id: 2, title: 'Book 2', authorFiling: 'Author, 2' }] },
    ])
  })

  it('leaves a checked out book alone and says so', () => {
    const out = [...PLACED, row(3, 'checked_out', null)]
    const move = movedToThree()
    const plan = planPlacements(NON_FICTION, out, move.rules, move.order, LABELS(ORDER))

    expect(plan.moving).toBe(2)
    expect(plan.skipped).toEqual([
      { reason: 'checked-out', books: [{ id: 3, title: 'Book 3', authorFiling: 'Author, 3' }] },
    ])
  })

  it('reports a book no rule claims instead of guessing a plank for it', () => {
    const move = movedToThree()
    const orphan = book(4, 'B', 'mine/lent-out')
    const plan = planPlacements(
      [...NON_FICTION, orphan],
      [...PLACED, row(4, 'placed', 40)],
      move.rules, move.order, LABELS(ORDER),
    )

    expect(plan.unclaimed).toEqual([{ id: 4, title: 'Book 4', authorFiling: 'Author, 4' }])
  })

  it('counts a book nobody has placed apart from the books to carry', () => {
    // There is no plank to take it off, so it is not a walk to the shelves; the
    // rules will still assign it.
    const move = movedToThree()
    const plan = planPlacements([...NON_FICTION, book(5, 'B')], PLACED,
      move.rules, move.order, LABELS(ORDER))

    expect(plan.moving).toBe(3)
    expect(plan.skipped).toContainEqual({
      reason: 'never-placed', books: [{ id: 5, title: 'Book 5', authorFiling: 'Author, 5' }],
    })
  })

  it('has nothing to say about a run already where the rules want it', () => {
    const plan = planPlacements(NON_FICTION, PLACED, RULES, ORDER, LABELS(ORDER))
    expect(plan.moving).toBe(0)
    expect(plan.staying).toBe(3)
    expect(plan.groups).toEqual([])
  })

  it('still names the plank a book was recorded on after that plank is taken out', () => {
    /*
     * A retired plank is on no arrangement there is, and what a person wrote
     * down is still `4D`. Reading the label out of the furniture alone would
     * show the move as coming from nowhere, which is not somewhere anybody can
     * go and pick a book up from.
     */
    const move = movedToThree()
    const retired = new Map(LABELS(ORDER)).set(99, '4D')
    const plan = planPlacements(
      [book(6, 'Z')], [row(6, 'placed', 99)], move.rules, move.order, retired,
    )
    expect(plan.groups).toEqual([
      { from: '4D', to: '3C', books: [{ id: 6, title: 'Book 6', authorFiling: 'Author, 6' }] },
    ])
  })
  it('carries a book onto the twin bookcase standing on the same number', () => {
    /*
     * #430 item 1. Two pieces of furniture standing on one number is an
     * arrangement `slotsInOrder` names as one this catalogue has, and both
     * render `4A`. A plan that decided on the two strings called this book
     * "staying exactly where it is" while the engine, which compares area ids,
     * wrote an assignment moving it, and the carry list then read `4A` to `4A`.
     *
     * The preview and the engine have to be one answer, so this asks the plan
     * for the answer the engine gives.
     */
    const twin = slotsInOrder(
      [fixture(1, 1), fixture(4, 4), fixture(5, 4)],
      [area(10, 1, 0), area(40, 4, 0), area(50, 5, 0)],
    )
    const onTwin = [onTag(1, 'genre/fiction', 1), {
      ...onTag(2, 'genre/non-fiction', 5), areaId: 50, fixtureId: null,
    }]

    const plan = planPlacements(
      [book(1, 'A')], [row(1, 'placed', 40)], onTwin, twin, LABELS(twin),
    )

    expect(labelFor(twin.find((slot) => slot.area.id === 40)!)).toBe('4A')
    expect(labelFor(twin.find((slot) => slot.area.id === 50)!)).toBe('4A')
    expect(plan.staying).toBe(0)
    expect(plan.moving).toBe(1)
    expect(plan.groups).toEqual([
      { from: '4A', to: '4A', books: [{ id: 1, title: 'Book 1', authorFiling: 'Author, 1' }] },
    ])
  })
})
