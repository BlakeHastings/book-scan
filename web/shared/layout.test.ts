import { describe, expect, it } from 'vitest'
import {
  areaLabel, diffLayout, groupByShelf, layoutRange, locationLabel, shelfLoads,
  type Separator,
} from './layout'

const book = (id: number, sortKey: string) => ({ id, sortKey })

/** Books named by a single letter, so the sort order is obvious at a glance. */
const run = (letters: string) =>
  [...letters].map((letter, i) => book(i + 1, letter))

const sep = (
  id: number,
  capacity: number,
  kind: 'shelf' | 'area' = 'shelf',
): Separator => ({ id, range: 'fiction', kind, capacity, position: id })

const labels = (books: { id: number; sortKey: string }[], separators: Separator[]) =>
  layoutRange(books, separators).map((p) => p.label)

describe('areaLabel', () => {
  it('counts A to Z then carries', () => {
    expect(areaLabel(0)).toBe('A')
    expect(areaLabel(25)).toBe('Z')
    expect(areaLabel(26)).toBe('AA')
    expect(areaLabel(27)).toBe('AB')
  })

  it('builds a location from an area and a shelf', () => {
    expect(locationLabel(0, 1)).toBe('A1')
    expect(locationLabel(1, 3)).toBe('B3')
  })
})

describe('layoutRange', () => {
  it('puts everything on one shelf while nothing is marked full', () => {
    expect(labels(run('ABCD'), [])).toEqual(['A1', 'A1', 'A1', 'A1'])
  })

  it('fills a shelf to its capacity then starts the next', () => {
    // "This shelf holds two."
    expect(labels(run('ABCD'), [sep(1, 2)])).toEqual(['A1', 'A1', 'A2', 'A2'])
  })

  it('starts a new area, resetting the shelf number', () => {
    expect(labels(run('ABCD'), [sep(1, 2, 'area')])).toEqual(['A1', 'A1', 'B1', 'B1'])
  })

  it('handles shelves and areas together', () => {
    expect(labels(run('ABCD'), [sep(1, 1), sep(2, 2, 'area')]))
      .toEqual(['A1', 'A2', 'A2', 'B1'])
  })

  it('pushes the last book off a full shelf when one is inserted before it', () => {
    // The case the whole feature exists for. A1 holds two. Insert a book that
    // sorts first and the previous second book has to physically move.
    expect(labels(run('BC'), [sep(1, 2)])).toEqual(['A1', 'A1'])
    expect(labels(run('ABC'), [sep(1, 2)])).toEqual(['A1', 'A1', 'A2'])
  })

  it('cascades the displacement across later shelves', () => {
    // Every shelf is full, so one insert shunts a book off each in turn.
    const two = [sep(1, 2), sep(2, 2)]
    expect(labels(run('BCDE'), two)).toEqual(['A1', 'A1', 'A2', 'A2'])
    expect(labels(run('ABCDE'), two)).toEqual(['A1', 'A1', 'A2', 'A2', 'A3'])
  })

  it('leaves a shelf short rather than pulling books back', () => {
    // Removing a book does not drag the next shelf's first book backwards:
    // capacity is a ceiling, not a quota to fill.
    expect(labels(run('AC'), [sep(1, 2)])).toEqual(['A1', 'A1'])
  })

  it('is unaffected by the order separators are given in', () => {
    const forwards = labels(run('ABCD'), [sep(1, 1), sep(2, 2, 'area')])
    const backwards = labels(run('ABCD'), [sep(2, 2, 'area'), sep(1, 1)])
    expect(backwards).toEqual(forwards)
  })

  it('survives a capacity of zero rather than stalling', () => {
    // A zero would loop forever if take() trusted it.
    expect(labels(run('AB'), [sep(1, 0)])).toEqual(['A2', 'A2'])
  })

  it('copes with more separators than books', () => {
    expect(labels(run('A'), [sep(1, 5), sep(2, 5), sep(3, 5)])).toEqual(['A1'])
  })

  it('copes with no books at all', () => {
    expect(layoutRange([], [sep(1, 3)])).toEqual([])
  })
})

describe('diffLayout', () => {
  it('reports the book pushed onto the next shelf', () => {
    const full = [sep(1, 2)]
    const before = layoutRange(run('BC'), full)
    // Inserting A shifts everything; ids stay tied to their letters here, so
    // build the after-run explicitly.
    const after = layoutRange(
      [book(9, 'A'), book(1, 'B'), book(2, 'C')], full,
    )
    expect(diffLayout(before, after)).toEqual([{ id: 2, from: 'A1', to: 'A2' }])
  })

  it('says nothing when an insert displaces no one', () => {
    const before = layoutRange(run('AC'), [])
    const after = layoutRange([book(1, 'A'), book(9, 'B'), book(2, 'C')], [])
    expect(diffLayout(before, after)).toEqual([])
  })

  it('ignores the newly added book, which was nowhere before', () => {
    const before = layoutRange(run('A'), [])
    const after = layoutRange([book(1, 'A'), book(9, 'B')], [])
    expect(diffLayout(before, after)).toEqual([])
  })

  it('reports a move into the next area', () => {
    const full = [sep(1, 2, 'area')]
    const before = layoutRange(run('BC'), full)
    const after = layoutRange([book(9, 'A'), book(1, 'B'), book(2, 'C')], full)
    expect(diffLayout(before, after)).toEqual([{ id: 2, from: 'A1', to: 'B1' }])
  })

  it('reports every book that shifts, not just the first', () => {
    const two = [sep(1, 2), sep(2, 2, 'area')]
    const before = layoutRange(run('BCDE'), two)
    const after = layoutRange(
      [book(9, 'A'), book(1, 'B'), book(2, 'C'), book(3, 'D'), book(4, 'E')], two,
    )
    expect(diffLayout(before, after)).toEqual([
      { id: 2, from: 'A1', to: 'A2' },
      { id: 4, from: 'A2', to: 'B1' },
    ])
  })
})

describe('groupByShelf and shelfLoads', () => {
  it('groups a run into one entry per physical shelf', () => {
    const separators = [sep(1, 1)]
    const groups = groupByShelf(layoutRange(run('ABC'), separators), separators)
    expect(groups.map((g) => g.label)).toEqual(['A1', 'A2'])
    expect(groups[1]!.books.map((b) => b.book.id)).toEqual([2, 3])
  })

  it('carries the separator that closes each shelf, so it can be removed', () => {
    const separators = [sep(7, 1, 'area')]
    const groups = groupByShelf(layoutRange(run('ABC'), separators), separators)
    expect(groups[0]).toMatchObject({ capacity: 1, separatorId: 7, kind: 'area' })
    // The final, open-ended shelf has no separator closing it.
    expect(groups[1]).toMatchObject({ capacity: null, separatorId: null })
  })

  it('counts how full each shelf is against its capacity', () => {
    const separators = [sep(1, 1, 'area')]
    expect(shelfLoads(layoutRange(run('ABC'), separators), separators)).toEqual([
      { label: 'A1', count: 1, capacity: 1, over: false },
      { label: 'B1', count: 2, capacity: null, over: false },
    ])
  })

  it('flags a shelf holding more than it was marked to hold', () => {
    // Reachable by lowering a capacity after the fact.
    const separators = [sep(1, 5)]
    const loads = shelfLoads(layoutRange(run('AB'), separators), separators)
    expect(loads[0]).toMatchObject({ count: 2, capacity: 5, over: false })

    const tighter = [sep(1, 1)]
    const after = shelfLoads(layoutRange(run('AB'), tighter), tighter)
    expect(after[0]).toMatchObject({ count: 1, capacity: 1, over: false })
  })
})
