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
  kind: 'shelf' | 'area' = 'area',
): Separator => ({ id, range: 'fiction', kind, startsAt, position: id })

const labels = (books: { id: number; sortKey: string }[], separators: Separator[]) =>
  layoutRange(books, separators).map((p) => p.label)

describe('labels', () => {
  it('letters the areas, which are the planks inside one bookcase', () => {
    expect(areaLabel(0)).toBe('A')
    expect(areaLabel(25)).toBe('Z')
    expect(areaLabel(26)).toBe('AA')
  })

  it('reads shelf then area, so 1A is the top plank of bookcase 1', () => {
    expect(locationLabel(1, 0)).toBe('1A')
    expect(locationLabel(1, 1)).toBe('1B')
    expect(locationLabel(3, 0)).toBe('3A')
  })
})

describe('layoutRange', () => {
  it('puts everything on one shelf until a boundary exists', () => {
    expect(labels(run('ABCD'), [])).toEqual(['1A', '1A', '1A', '1A'])
  })

  it('starts the next area at the book the boundary names', () => {
    expect(labels(run('ABCD'), [sep(1, 'C', 'area')])).toEqual(['1A', '1A', '1B', '1B'])
  })

  it('starts a new shelf back at its top plank', () => {
    expect(labels(run('ABCD'), [sep(1, 'C', 'shelf')])).toEqual(['1A', '1A', '2A', '2A'])
  })

  it('lets a shelf simply grow when a book is inserted into it', () => {
    // The heart of the change. A thin book may well fit, so nothing is
    // displaced automatically; only a person can say otherwise.
    expect(labels(run('ACD'), [sep(1, 'C')])).toEqual(['1A', '1B', '1B'])
    expect(labels(run('ABCD'), [sep(1, 'C')])).toEqual(['1A', '1A', '1B', '1B'])
  })

  it('keeps a boundary meaningful when the book it named is deleted', () => {
    expect(labels(run('ABD'), [sep(1, 'C')])).toEqual(['1A', '1A', '1B'])
  })

  it('is unaffected by the order boundaries are given in', () => {
    const forwards = labels(run('ABCD'), [sep(1, 'B'), sep(2, 'D', 'shelf')])
    const backwards = labels(run('ABCD'), [sep(2, 'D', 'shelf'), sep(1, 'B')])
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

    const step = overflow(placed, separators, '1A')!
    expect(step.moved.sortKey).toBe('B')
    expect(step.from).toBe('1A')
    expect(step.to).toBe('1B')
    // The next shelf now begins one book earlier.
    expect(step.shift).toEqual({ id: 1, startsAt: 'B' })
  })

  it('creates the next shelf when there is not one yet', () => {
    const placed = layoutRange(run('AB'), [])
    const step = overflow(placed, [], '1A')!
    expect(step.to).toBe('1B')
    expect(step.create).toEqual({ startsAt: 'B', kind: 'area' })
  })

  it('can start a whole new bookcase instead of the next plank', () => {
    const placed = layoutRange(run('AB'), [])
    const step = overflow(placed, [], '1A', 'shelf')!
    // A new bookcase, so the area letter resets rather than advancing.
    expect(step.to).toBe('2A')
    expect(step.create).toEqual({ startsAt: 'B', kind: 'shelf' })
  })

  it('refuses to empty a shelf holding a single book', () => {
    // Moving its only book would leave the shelf empty and solve nothing.
    const separators = [sep(1, 'B')]
    expect(overflow(layoutRange(run('AB'), separators), separators, '1A')).toBeNull()
  })

  it('returns nothing for a shelf that does not exist', () => {
    expect(overflow(layoutRange(run('AB'), []), [], '9Z')).toBeNull()
  })

  it('walks along when applied repeatedly, which is the guided sequence', () => {
    // A1 full: B moves to A2. Then A2 full too: its last book moves to A3.
    let separators = [sep(1, 'C')]
    const first = overflow(layoutRange(run('ABCD'), separators), separators, '1A')!
    separators = [{ ...separators[0]!, startsAt: first.shift!.startsAt }]
    expect(labels(run('ABCD'), separators)).toEqual(['1A', '1B', '1B', '1B'])

    const second = overflow(layoutRange(run('ABCD'), separators), separators, '1B')!
    expect(second.moved.sortKey).toBe('D')
    expect(second.create).toEqual({ startsAt: 'D', kind: 'area' })
  })
})

describe('groupByShelf', () => {
  it('groups a run into one entry per physical shelf', () => {
    const separators = [sep(7, 'B', 'shelf')]
    const groups = groupByShelf(layoutRange(run('ABC'), separators), separators)
    expect(groups.map((g) => g.label)).toEqual(['1A', '2A'])
    expect(groups[1]!.books.map((b) => b.book.id)).toEqual([2, 3])
    // The boundary that opens the shelf, so the UI can offer to remove it.
    expect(groups[1]).toMatchObject({ separatorId: 7, kind: 'shelf' })
    expect(groups[0]).toMatchObject({ separatorId: null })
  })

  it('counts what is on each shelf without predicting what fits', () => {
    const separators = [sep(1, 'C')]
    expect(shelfLoads(layoutRange(run('ABCD'), separators), separators)).toEqual([
      { label: '1A', count: 2 },
      { label: '1B', count: 2 },
    ])
  })
})
