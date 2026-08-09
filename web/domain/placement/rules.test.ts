import { describe, expect, it } from 'vitest'
import { slotsInOrder, type Area, type Fixture } from './geography'
import { claim, entryAreas, matches, placementOf, type PlacementRule } from './rules'
import { INHERIT } from './strategies'

const fixture = (id: number, position: number): Fixture =>
  ({ id, position, kind: 'bookshelf', name: '', sortStrategy: INHERIT })

const area = (id: number, fixtureId: number, position: number, startsAt = ''): Area =>
  ({ id, fixtureId, position, name: '', startsAt, sortStrategy: INHERIT })

const rule = (over: Partial<PlacementRule> & { id: number }): PlacementRule => ({
  areaId: null,
  fixtureId: null,
  priority: 1,
  name: '',
  enabled: true,
  conditions: [],
  ...over,
})

const onTag = (id: number, value: string, over: Partial<PlacementRule> = {}) =>
  rule({ id, conditions: [{ field: 'tag', operator: 'is', value }], ...over })

describe('whether a rule claims a book', () => {
  it('needs every condition to hold', () => {
    const both = rule({
      id: 1,
      fixtureId: 1,
      conditions: [
        { field: 'tag', operator: 'is', value: 'genre/fiction' },
        { field: 'tag', operator: 'is', value: 'mine/signed' },
      ],
    })
    expect(matches(both, { tagSlugs: ['genre/fiction', 'mine/signed'] })).toBe(true)
    expect(matches(both, { tagSlugs: ['genre/fiction'] })).toBe(false)
  })

  it('tells `is` and `under` apart', () => {
    const isFantasy = onTag(1, 'genre/fantasy', { fixtureId: 1 })
    const underGenre = rule({
      id: 2, fixtureId: 1,
      conditions: [{ field: 'tag', operator: 'under', value: 'genre' }],
    })
    expect(matches(isFantasy, { tagSlugs: ['genre/fantasy'] })).toBe(true)
    expect(matches(isFantasy, { tagSlugs: ['genre/fantasy/epic'] })).toBe(false)
    // Asked of the path, so no `genre` row has to exist for this to find it.
    expect(matches(underGenre, { tagSlugs: ['genre/fantasy/epic'] })).toBe(true)
    // Strictly beneath: `genre` is not under `genre`.
    expect(matches(underGenre, { tagSlugs: ['genre'] })).toBe(false)
  })

  it('matches the slug however the tag was spelled on the way in', () => {
    // The reason a rule references a slug and never a label: a catalogue
    // answering "Non-Fiction" and one answering "non fiction" are one idea.
    const nonFiction = onTag(1, 'Non-Fiction', { fixtureId: 1 })
    expect(matches(nonFiction, { tagSlugs: ['non-fiction'] })).toBe(true)
  })

  it('claims nothing when it says nothing, rather than claiming everything', () => {
    // "All of no conditions hold" is true, and a rule somebody half built would
    // otherwise take the whole catalogue.
    expect(matches(rule({ id: 1, fixtureId: 1 }), { tagSlugs: ['genre/fiction'] })).toBe(false)
  })

  it('claims nothing when it is disabled', () => {
    expect(matches(onTag(1, 'genre/fiction', { fixtureId: 1, enabled: false }),
      { tagSlugs: ['genre/fiction'] })).toBe(false)
  })
})

describe('which rule wins when two claim a book', () => {
  it('prefers the area rule, being the more specific statement', () => {
    const byFixture = onTag(1, 'genre/fiction', { fixtureId: 1, priority: 1 })
    const byArea = onTag(2, 'genre/fiction', { areaId: 7, priority: 9 })
    expect(claim([byFixture, byArea], { tagSlugs: ['genre/fiction'] })?.id).toBe(2)
  })

  it('takes the lower priority within a level', () => {
    const first = onTag(1, 'genre/fiction', { fixtureId: 1, priority: 1 })
    const second = onTag(2, 'genre/fiction', { fixtureId: 2, priority: 2 })
    expect(claim([second, first], { tagSlugs: ['genre/fiction'] })?.id).toBe(1)
    expect(claim([second, { ...first, priority: 3 }], { tagSlugs: ['genre/fiction'] })?.id).toBe(2)
  })

  it('answers null for a book nothing claims', () => {
    // A real answer, not a gap. A book no rule claims has nowhere the rules can
    // put it, and saying so is how whoever wrote them finds out.
    expect(claim([onTag(1, 'genre/fiction', { fixtureId: 1 })], { tagSlugs: [] })).toBeNull()
  })
})

describe('where a book ends up', () => {
  const order = slotsInOrder(
    [fixture(1, 1), fixture(2, 2), fixture(3, 4)],
    [
      area(10, 1, 0),
      area(11, 1, 1, 'M'),
      area(12, 2, 0, 'S'),
      area(20, 3, 0),
    ],
  )
  const fiction = onTag(1, 'genre/fiction', { fixtureId: 1, priority: 1 })
  const nonFiction = onTag(2, 'genre/non-fiction', { fixtureId: 3, priority: 2 })
  const rules = [fiction, nonFiction]

  it('follows the rule to a run and the sort key to an area in it', () => {
    expect(placementOf({ tagSlugs: ['genre/fiction'], sortKey: 'N' }, rules, order)?.slot.area.id)
      .toBe(11)
    expect(placementOf({ tagSlugs: ['genre/non-fiction'], sortKey: 'N' }, rules, order)
      ?.slot.area.id).toBe(20)
  })

  it('keeps one range out of the next one, which is what the entry points cut', () => {
    // A fiction book sorting past every fiction anchor lands on the last fiction
    // plank and not on the non-fiction bookcase after it.
    expect(placementOf({ tagSlugs: ['genre/fiction'], sortKey: 'ZZZ' }, rules, order)
      ?.slot.area.id).toBe(12)
    expect(entryAreas(rules, order)).toEqual(new Set([10, 20]))
  })

  it('sends a book carrying both genre tags wherever priority says', () => {
    /*
     * The rows #201 stopped happening: correcting a book's ISBN used to leave
     * the old book's genre tag beside the new one. Both rules claim such a book
     * and it is `priority` that decides, which is exactly why swapping the two
     * priorities is a change the comparison against the old model can see.
     */
    const both = { tagSlugs: ['genre/fiction', 'genre/non-fiction'], sortKey: 'A' }
    expect(placementOf(both, rules, order)?.rule.id).toBe(1)
    expect(placementOf(both, [{ ...fiction, priority: 3 }, nonFiction], order)?.rule.id).toBe(2)
  })

  it('puts nowhere the book nothing claims', () => {
    expect(placementOf({ tagSlugs: ['mine/lent-out'], sortKey: 'A' }, rules, order)).toBeNull()
  })

  it('leaves a run empty rather than merging it when its rule is turned off', () => {
    // Disabling a rule stops it claiming books. It does not hand its areas to
    // the run before, which would re-cut every plank after it.
    const off = [fiction, { ...nonFiction, enabled: false }]
    expect(entryAreas(off, order)).toEqual(new Set([10, 20]))
    expect(placementOf({ tagSlugs: ['genre/fiction'], sortKey: 'ZZZ' }, off, order)
      ?.slot.area.id).toBe(12)
  })
})
