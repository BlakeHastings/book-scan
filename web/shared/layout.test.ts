import { describe, expect, it } from 'vitest'
import {
  areaLabel, groupByShelf, layoutRange, locationLabel, overflow, shelfLoads,
  type Separator,
} from './layout'

const book = (id: number, sortKey: string) => ({ id, sortKey })

/** Books named by a single letter, so the sort order is obvious at a glance. */
const run = (letters: string) =>
  [...letters].map((letter, i) => book(i + 1, letter))

/** A boundary: the shelf starts AT this sort key. */
const sep = (
  id: number,
  startsAt: string,
  kind: 'shelf' | 'area' = 'shelf',
): Separator => ({ id, range: 'fiction', kind, startsAt, position: id })

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
  it('puts everything on one shelf until a boundary exists', () => {
    expect(labels(run('ABCD'), [])).toEqual(['A1', 'A1', 'A1', 'A1'])
  })

  it('starts the next shelf at the book the boundary names', () => {
    expect(labels(run('ABCD'), [sep(1, 'C')])).toEqual(['A1', 'A1', 'A2', 'A2'])
  })

  it('starts a new area, resetting the shelf number', () => {
    expect(labels(run('ABCD'), [sep(1, 'C', 'area')])).toEqual(['A1', 'A1', 'B1', 'B1'])
  })

  it('lets a shelf simply grow when a book is inserted into it', () => {
    // The heart of the change. A thin book may well fit, so nothing is
    // displaced automatically; only a person can say otherwise.
    expect(labels(run('ACD'), [sep(1, 'C')])).toEqual(['A1', 'A2', 'A2'])
    expect(labels(run('ABCD'), [sep(1, 'C')])).toEqual(['A1', 'A1', 'A2', 'A2'])
  })

  it('keeps a boundary meaningful when the book it named is deleted', () => {
    expect(labels(run('ABD'), [sep(1, 'C')])).toEqual(['A1', 'A1', 'A2'])
  })

  it('is unaffected by the order boundaries are given in', () => {
    const forwards = labels(run('ABCD'), [sep(1, 'B'), sep(2, 'D', 'area')])
    const backwards = labels(run('ABCD'), [sep(2, 'D', 'area'), sep(1, 'B')])
    expect(backwards).toEqual(forwards)
  })

  it('copes with no books at all', () => {
    expect(layoutRange([], [sep(1, 'B')])).toEqual([])
  })
})

describe('overflow, when someone says a shelf is full', () => {
  it('moves the last book onto the next shelf', () => {
    const separators = [sep(1, 'C')]
    const placed = layoutRange(run('ABCD'), separators)

    const step = overflow(placed, separators, 'A1')!
    expect(step.moved.sortKey).toBe('B')
    expect(step.from).toBe('A1')
    expect(step.to).toBe('A2')
    // The next shelf now begins one book earlier.
    expect(step.shift).toEqual({ id: 1, startsAt: 'B' })
  })

  it('creates the next shelf when there is not one yet', () => {
    const placed = layoutRange(run('AB'), [])
    const step = overflow(placed, [], 'A1')!
    expect(step.to).toBe('A2')
    expect(step.create).toEqual({ startsAt: 'B', kind: 'shelf' })
  })

  it('can start a new area instead of a new shelf', () => {
    const placed = layoutRange(run('AB'), [])
    const step = overflow(placed, [], 'A1', 'area')!
    expect(step.to).toBe('B1')
    expect(step.create).toEqual({ startsAt: 'B', kind: 'area' })
  })

  it('refuses to empty a shelf holding a single book', () => {
    // Moving its only book would leave the shelf empty and solve nothing.
    const separators = [sep(1, 'B')]
    expect(overflow(layoutRange(run('AB'), separators), separators, 'A1')).toBeNull()
  })

  it('returns nothing for a shelf that does not exist', () => {
    expect(overflow(layoutRange(run('AB'), []), [], 'Z9')).toBeNull()
  })

  it('walks along when applied repeatedly, which is the guided sequence', () => {
    // A1 full: B moves to A2. Then A2 full too: its last book moves to A3.
    let separators = [sep(1, 'C')]
    const first = overflow(layoutRange(run('ABCD'), separators), separators, 'A1')!
    separators = [{ ...separators[0]!, startsAt: first.shift!.startsAt }]
    expect(labels(run('ABCD'), separators)).toEqual(['A1', 'A2', 'A2', 'A2'])

    const second = overflow(layoutRange(run('ABCD'), separators), separators, 'A2')!
    expect(second.moved.sortKey).toBe('D')
    expect(second.create).toEqual({ startsAt: 'D', kind: 'shelf' })
  })
})

describe('groupByShelf', () => {
  it('groups a run into one entry per physical shelf', () => {
    const separators = [sep(7, 'B', 'area')]
    const groups = groupByShelf(layoutRange(run('ABC'), separators), separators)
    expect(groups.map((g) => g.label)).toEqual(['A1', 'B1'])
    expect(groups[1]!.books.map((b) => b.book.id)).toEqual([2, 3])
    // The boundary that opens the shelf, so the UI can offer to remove it.
    expect(groups[1]).toMatchObject({ separatorId: 7, kind: 'area' })
    expect(groups[0]).toMatchObject({ separatorId: null })
  })

  it('counts what is on each shelf without predicting what fits', () => {
    const separators = [sep(1, 'C')]
    expect(shelfLoads(layoutRange(run('ABCD'), separators), separators)).toEqual([
      { label: 'A1', count: 2 },
      { label: 'A2', count: 2 },
    ])
  })
})
