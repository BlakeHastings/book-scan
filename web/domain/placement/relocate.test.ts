import { describe, expect, it } from 'vitest'
import { labelFor, slotsInOrder, type Area, type Fixture } from './geography'
import { placementOf, type PlacementRule } from './rules'
import { relocateRun } from './relocate'
import { INHERIT } from './strategies'

const fixture = (id: number, position: number): Fixture =>
  ({ id, position, kind: 'bookshelf', name: '', sortStrategy: INHERIT })

const area = (id: number, fixtureId: number, position: number, startsAt = ''): Area =>
  ({ id, fixtureId, position, name: '', startsAt, sortStrategy: INHERIT })

const onTag = (
  priority: number,
  value: string,
  over: Partial<PlacementRule> & { id: number },
): PlacementRule => ({
  areaId: null,
  fixtureId: null,
  priority,
  name: value,
  enabled: true,
  conditions: [{ field: 'tag', operator: 'is', value }],
  ...over,
})

/**
 * The shape the owner's catalogue is in: fiction on bookcase 1, non-fiction on
 * bookcase 4 cut into three planks, and no bookcases 2 or 3 in the rows at all.
 */
const FICTION = onTag(1, 'genre/fiction', { id: 1, fixtureId: 1 })
const NON_FICTION = onTag(2, 'genre/non-fiction', { id: 2, fixtureId: 4 })
const RULES = [FICTION, NON_FICTION]

const ORDER = slotsInOrder(
  [fixture(1, 1), fixture(4, 4)],
  [
    area(10, 1, 0),
    area(40, 4, 0),
    area(41, 4, 1, 'K'),
    area(42, 4, 2, 'S'),
  ],
)

describe('moving a run to another bookcase', () => {
  it('renames nothing: the planks it makes are different rows from the ones it leaves', () => {
    /*
     * The whole reason this is a rule retarget and not a fixture renumber. If
     * the areas came along, every book would keep the area it was placed in and
     * its label would move with the furniture, so the plan would be empty and
     * nobody would carry anything.
     */
    const moved = relocateRun(ORDER, RULES, 2, 3)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return

    const landing = moved.move.order.filter((slot) => slot.fixture.position === 3)
    expect(landing.map((slot) => slot.area.id)).not.toContain(40)
    expect(landing.map((slot) => slot.area.id)).not.toContain(41)
    expect(landing.map((slot) => slot.area.id)).not.toContain(42)
  })

  it('takes the run\'s own cuts with it, plank for plank', () => {
    // 4A, 4B and 4C become 3A, 3B and 3C, anchored where they were, so the same
    // books land together and capacity never comes into it.
    const moved = relocateRun(ORDER, RULES, 2, 3)
    if (!moved.ok) throw new Error(moved.error)

    expect(moved.move.from).toBe(4)
    expect(moved.move.to).toBe(3)
    expect(moved.move.planks).toEqual([
      { from: '4A', to: '3A' },
      { from: '4B', to: '3B' },
      { from: '4C', to: '3C' },
    ])
    expect(moved.move.order
      .filter((slot) => slot.fixture.position === 3)
      .map((slot) => slot.area.startsAt)).toEqual(['', 'K', 'S'])
  })

  it('sends the books the moved rule claims to the new bookcase', () => {
    const moved = relocateRun(ORDER, RULES, 2, 3)
    if (!moved.ok) throw new Error(moved.error)

    const { order, rules } = moved.move
    const where = (sortKey: string) =>
      labelFor(placementOf({ tagSlugs: ['genre/non-fiction'], sortKey }, rules, order)!.slot)

    expect(where('A')).toBe('3A')
    expect(where('L')).toBe('3B')
    expect(where('T')).toBe('3C')
  })

  it('leaves every other run exactly where it was', () => {
    const moved = relocateRun(ORDER, RULES, 2, 3)
    if (!moved.ok) throw new Error(moved.error)

    expect(labelFor(placementOf(
      { tagSlugs: ['genre/fiction'], sortKey: 'A' }, moved.move.rules, moved.move.order,
    )!.slot)).toBe('1A')
    // And the fiction run does not flow onto the bookcase non-fiction left,
    // because nothing is standing on it any more.
    expect(moved.move.order.some((slot) => slot.fixture.position === 4)).toBe(false)
  })

  it('is a no-op, not a refusal, when the run is already there', () => {
    // Applying twice has to be safe, and the second call is this case.
    const moved = relocateRun(ORDER, RULES, 2, 4)
    if (!moved.ok) throw new Error(moved.error)
    expect(moved.move.planks).toEqual([])
    expect(moved.move.order).toBe(ORDER)
  })

  it('refuses a bookcase another run is standing on', () => {
    // A bookcase holds one run. Pouring non-fiction onto fiction's shelves is
    // the arrangement `0013` refuses outright, and merging two runs is a
    // question #242 leaves open rather than one to answer here.
    const moved = relocateRun(ORDER, RULES, 2, 1)
    expect(moved).toEqual({ ok: false, error: expect.stringContaining('Bookcase 1 already has') })
  })

  it('refuses a bookcase number that is not one', () => {
    expect(relocateRun(ORDER, RULES, 2, 0).ok).toBe(false)
    expect(relocateRun(ORDER, RULES, 2, 1.5).ok).toBe(false)
  })

  it('refuses a rule that names one plank rather than a bookcase', () => {
    // An area rule says "this exact plank". There is no run behind it to move.
    const pinned = [FICTION, { ...NON_FICTION, fixtureId: null, areaId: 40 }]
    const moved = relocateRun(ORDER, pinned, 2, 3)
    expect(moved).toEqual({ ok: false, error: expect.stringContaining('names one plank') })
  })

  it('refuses when the rule points at a bookcase with no planks on it', () => {
    const nowhere = [FICTION, { ...NON_FICTION, fixtureId: 9 }]
    expect(relocateRun(ORDER, nowhere, 2, 3).ok).toBe(false)
  })

  it('carries a run that spans two bookcases across as a whole', () => {
    const wide = slotsInOrder(
      [fixture(1, 1), fixture(2, 2), fixture(4, 4)],
      [area(10, 1, 0), area(11, 1, 1, 'M'), area(20, 2, 0, 'S'), area(40, 4, 0)],
    )
    const moved = relocateRun(wide, RULES, 1, 6)
    if (!moved.ok) throw new Error(moved.error)

    expect(moved.move.planks).toEqual([
      { from: '1A', to: '6A' },
      { from: '1B', to: '6B' },
      { from: '2A', to: '7A' },
    ])
  })
})
