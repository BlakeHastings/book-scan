import { describe, expect, it } from 'vitest'
import {
  areaFor, labelFor, runFrom, slotsInOrder, type Area, type Fixture,
} from './geography'
import { INHERIT, type SortStrategy } from './strategies'

const fixture = (id: number, position: number, name = ''): Fixture =>
  ({ id, position, kind: 'bookshelf', name, sortStrategy: INHERIT })

const area = (
  id: number, fixtureId: number, position: number,
  over: { name?: string; startsAt?: string; sortStrategy?: SortStrategy } = {},
): Area => ({
  id,
  fixtureId,
  position,
  name: over.name ?? '',
  startsAt: over.startsAt ?? '',
  sortStrategy: over.sortStrategy ?? INHERIT,
})

describe('the label a person reads', () => {
  it('is built from the positions and the two names', () => {
    // The table in docs/data-model.md, one row at a time.
    expect(labelFor({ fixture: fixture(1, 1), area: area(1, 1, 0) })).toBe('1A')
    expect(labelFor({ fixture: fixture(1, 1, 'Hall shelf'), area: area(1, 1, 0) }))
      .toBe('Hall shelf · A')
    expect(labelFor({
      fixture: fixture(1, 1, 'Hall shelf'), area: area(1, 1, 0, { name: 'Cookery' }),
    })).toBe('Hall shelf · Cookery')
    expect(labelFor({ fixture: fixture(1, 1), area: area(1, 1, 0, { name: 'Cookery' }) }))
      .toBe('1 · Cookery')
  })

  it('keeps counting past Z, which is what the recorded locations already do', () => {
    expect(labelFor({ fixture: fixture(2, 2), area: area(1, 2, 26) })).toBe('2AA')
  })

  it('changes the moment a fixture is renamed, which is why none is stored', () => {
    const before = labelFor({ fixture: fixture(1, 1), area: area(1, 1, 1) })
    const after = labelFor({ fixture: fixture(1, 1, 'Landing'), area: area(1, 1, 1) })
    expect(before).toBe('1B')
    expect(after).toBe('Landing · B')
  })
})

describe('the sequence of areas', () => {
  it('is fixture position, then fixture id, then area position', () => {
    // Two fixtures at position 4 is what `shelf_ranges.start_shelf` produces
    // today, so the id in the middle is what keeps the answer the same between
    // two reads.
    const fixtures = [fixture(9, 4), fixture(1, 1), fixture(5, 4)]
    const areas = [area(3, 5, 0), area(1, 1, 1), area(2, 1, 0), area(4, 9, 0)]
    expect(slotsInOrder(fixtures, areas).map((slot) => slot.area.id))
      .toEqual([2, 1, 3, 4])
  })
})

describe('the run an area opens', () => {
  const fixtures = [fixture(1, 1), fixture(2, 2)]
  const areas = [
    area(10, 1, 0),
    area(11, 1, 1, { startsAt: 'M' }),
    area(12, 2, 0, { startsAt: 'S' }),
  ]
  const order = slotsInOrder(fixtures, areas)

  it('runs on across fixtures, because a range spans bookcases', () => {
    expect(runFrom(order, 10, new Set([10])).map((slot) => slot.area.id))
      .toEqual([10, 11, 12])
  })

  it('stops where the next rule points, so two runs do not merge', () => {
    expect(runFrom(order, 10, new Set([10, 12])).map((slot) => slot.area.id))
      .toEqual([10, 11])
    expect(runFrom(order, 12, new Set([10, 12])).map((slot) => slot.area.id))
      .toEqual([12])
  })

  it('stops at an area that orders itself, which takes no overflow', () => {
    // The settled decision: a continuous run only works if every area in it
    // orders the same way, so an area with a strategy of its own is the start
    // of its own run rather than the middle of somebody else's.
    const selfContained = slotsInOrder(fixtures, [
      areas[0]!, { ...areas[1]!, sortStrategy: 'title' }, areas[2]!,
    ])
    expect(runFrom(selfContained, 10, new Set([10])).map((slot) => slot.area.id))
      .toEqual([10])
    expect(runFrom(selfContained, 11, new Set([10])).map((slot) => slot.area.id))
      .toEqual([11, 12])
  })

  it('is empty when asked about the middle of a run somebody else opened', () => {
    expect(runFrom(order, 11, new Set([10]))).toEqual([])
  })
})

describe('which area a sort key lands in', () => {
  const order = slotsInOrder([fixture(1, 1)], [
    area(10, 1, 0),
    area(11, 1, 1, { startsAt: 'M' }),
    area(12, 1, 2, { startsAt: 'S' }),
  ])
  const run = runFrom(order, 10, new Set([10]))

  it('is the last area whose anchor the key has reached', () => {
    expect(areaFor(run, 'A')?.area.id).toBe(10)
    expect(areaFor(run, 'N')?.area.id).toBe(11)
    expect(areaFor(run, 'Z')?.area.id).toBe(12)
  })

  it('puts the anchoring book first in its own area, not last in the one before', () => {
    expect(areaFor(run, 'M')?.area.id).toBe(11)
    expect(areaFor(run, 'S')?.area.id).toBe(12)
  })

  it('steps over both of two areas sharing an anchor', () => {
    // What a boundary move that empties an area leaves behind: its anchor comes
    // to rest on the next one's. A book at that key belongs in the later area,
    // and stopping at the first would put it on a plank the person emptied.
    const emptied = runFrom(slotsInOrder([fixture(1, 1)], [
      area(10, 1, 0),
      area(11, 1, 1, { startsAt: 'M' }),
      area(12, 1, 2, { startsAt: 'M' }),
    ]), 10, new Set([10]))
    expect(areaFor(emptied, 'M')?.area.id).toBe(12)
  })

  it('says nothing about an empty run', () => {
    expect(areaFor([], 'M')).toBeNull()
  })
})
