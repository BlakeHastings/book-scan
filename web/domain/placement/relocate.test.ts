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

  /**
   * #499: the half of #420 `nextRunStartAfter` cannot see.
   *
   * A bookcase somebody else's run begins on is that run's furniture, and half
   * of one is nobody's to take. `nextRunStartAfter` says that about the pieces
   * a run stops at, because until #499 a second run opening on the piece a run
   * already opened on could not be reached: the band arithmetic bounded the
   * earlier range at its own start and left it with no planks at all. It can be
   * reached now, so the piece a move starts from is asked the same question.
   */
  it('refuses to take half of the bookcase it starts on', () => {
    // Fiction on bookcase 1, and "say what belongs here" pressed on `1C`. The
    // move would rehang `1A` and `1B` and leave `1C` on a bookcase with nothing
    // else on its face, which is the state `refuseAHalfStrippedPiece` throws on.
    const shared = slotsInOrder(
      [fixture(1, 1), fixture(4, 4)],
      [area(10, 1, 0), area(11, 1, 1, 'M'), area(12, 1, 2, 'S'), area(40, 4, 0)],
    )
    const rules = [FICTION, NON_FICTION, onTag(3, 'subject/comics', { id: 3, areaId: 12 })]

    const moved = relocateRun(shared, rules, 1, 3)
    expect(moved).toEqual({
      ok: false,
      error: expect.stringContaining('1C is where something else begins'),
    })
  })

  it('refuses the same when the other run is a plank that orders itself', () => {
    // Not a rule at all: an area given an ordering of its own is self-contained,
    // takes no overflow and heads its own run, which is what `startsARun` says
    // and what the dialog on that setting tells somebody before they press it.
    const ordered = slotsInOrder(
      [fixture(1, 1), fixture(4, 4)],
      [
        area(10, 1, 0), area(11, 1, 1, 'M'),
        { ...area(12, 1, 2, 'S'), sortStrategy: 'title' },
        area(40, 4, 0),
      ],
    )

    expect(relocateRun(ordered, RULES, 1, 3).ok).toBe(false)
  })

  it('still moves the whole bookcase when the only run on it is its own', () => {
    // The control. One run, one piece, nothing shared: the refusal above is
    // about a second run standing on this one's bookcase and not about a run
    // that happens to have three planks.
    const alone = slotsInOrder(
      [fixture(1, 1), fixture(4, 4)],
      [area(10, 1, 0), area(11, 1, 1, 'M'), area(12, 1, 2, 'S'), area(40, 4, 0)],
    )

    const moved = relocateRun(alone, RULES, 1, 3)
    if (!moved.ok) throw new Error(moved.error)
    expect(moved.move.planks).toEqual([
      { from: '1A', to: '3A' }, { from: '1B', to: '3B' }, { from: '1C', to: '3C' },
    ])
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

/**
 * #391: the pieces a move walks off, which is the half of it that is not about
 * books and which nothing said out loud.
 *
 * The usability baseline put up a bookcase called Hall after bookcase 4 and hung
 * four shelves on it. Nothing pointed a rule at it, so it was the tail of the
 * non-fiction run: moving that run one bookcase along took all four planks and
 * left the Hall bare, and every word on every screen was about books.
 *
 * Nothing is deleted, here or in the write. What this answers is what a person
 * reads before pressing anything, which is #307's shape applied to furniture.
 */
describe('the pieces a move would leave with nothing on them', () => {
  /** Bookcase 4, and a bookcase somebody put up after it with four empty planks. */
  const WITH_A_HALL = slotsInOrder(
    [fixture(1, 1), fixture(4, 4), { ...fixture(5, 5), name: 'Hall' }],
    [
      area(10, 1, 0),
      area(40, 4, 0), area(41, 4, 1, 'K'), area(42, 4, 2, 'S'),
      area(50, 5, 0, 'T'), area(51, 5, 1, 'U'), area(52, 5, 2, 'V'), area(53, 5, 3, 'W'),
    ],
  )

  it('names the piece the run walks off, by the name somebody gave it', () => {
    const moved = relocateRun(WITH_A_HALL, RULES, 2, 3)
    if (!moved.ok) throw new Error(moved.error)

    // Seven planks across two pieces, shifted one along onto bookcases 3 and 4.
    // Nothing of the run lands back on 5, so the Hall is left bare.
    expect(moved.move.emptied).toEqual([{ name: 'Hall', position: 5, planks: 4 }])
    expect(moved.move.planks).toContainEqual({ from: 'Hall · A', to: '4A' })
  })

  it('is quiet where the run only shuffles along furniture it covers again', () => {
    // 4A, 4B and 4C to 3A, 3B and 3C. Bookcase 4 is left bare and is named; the
    // point of the field is that the piece is said rather than that it is rare.
    const moved = relocateRun(ORDER, RULES, 2, 3)
    if (!moved.ok) throw new Error(moved.error)

    expect(moved.move.emptied).toEqual([{ name: '4', position: 4, planks: 3 }])
  })

  it('says nothing at all when the run is already where it is going', () => {
    const moved = relocateRun(ORDER, RULES, 2, 4)
    if (!moved.ok) throw new Error(moved.error)

    expect(moved.move.emptied).toEqual([])
    expect(moved.move.planks).toEqual([])
  })
})
