import { describe, expect, it } from 'vitest'
import {
  areaLabel, groupByShelf, layoutRange, locationLabel, NEWCOMER_ID, overflow,
  shelfLoads, stripAt, stripAround,
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

describe('stripAround', () => {
  /** Lay a run out with the newcomer slotted in by sort key, as the server does. */
  const withNewcomer = (letters: string, key: string, separators: Separator[] = []) =>
    layoutRange(
      [...run(letters), book(NEWCOMER_ID, key)]
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0)),
      separators,
    )

  it('returns the whole shelf the newcomer lands on', () => {
    const strip = stripAround(withNewcomer('ABDE', 'C'))!
    expect(strip.label).toBe('1A')
    expect(strip.books.map((p) => p.book.sortKey)).toEqual(['A', 'B', 'D', 'E'])
    expect(strip.gapIndex).toBe(2)
  })

  it('counts only the books on the same shelf, not the whole range', () => {
    // The point of the thing: five to the left across the range is not five
    // to the left on the shelf you are standing at.
    const strip = stripAround(withNewcomer('ABCDEF', 'DA', [sep(1, 'D')]))!
    expect(strip.label).toBe('1B')
    expect(strip.books.map((p) => p.book.sortKey)).toEqual(['D', 'E', 'F'])
    expect(strip.gapIndex).toBe(1)
  })

  it('reports a gap at the very start of a shelf', () => {
    const strip = stripAround(withNewcomer('BCD', 'A'))!
    expect(strip.gapIndex).toBe(0)
  })

  it('reports a gap at the very end of a shelf', () => {
    const strip = stripAround(withNewcomer('ABC', 'D'))!
    expect(strip.gapIndex).toBe(3)
  })

  it('copes with the first book in an empty range', () => {
    const strip = stripAround(withNewcomer('', 'A'))!
    expect(strip.books).toEqual([])
    expect(strip.gapIndex).toBe(0)
  })

  it('returns nothing when the newcomer was never laid out', () => {
    expect(stripAround(layoutRange(run('ABC'), []))).toBeNull()
  })
})

describe('stripAt', () => {
  it('finds a shelved book in its own row', () => {
    const separators = [sep(1, 'D')]
    const found = stripAt(layoutRange(run('ABCDEF'), separators), 5)!
    expect(found.label).toBe('1B')
    expect(found.books.map((p) => p.book.sortKey)).toEqual(['D', 'E', 'F'])
    expect(found.index).toBe(1)
  })

  it('leaves the book in place rather than cutting it out', () => {
    // The difference from stripAround: a book already on the shelf is drawn
    // where it is, not as a hole where it would go.
    const found = stripAt(layoutRange(run('ABC'), []), 1)!
    expect(found.books).toHaveLength(3)
    expect(found.index).toBe(0)
  })

  it('returns nothing for a book that is not shelved here', () => {
    expect(stripAt(layoutRange(run('ABC'), []), 99)).toBeNull()
  })
})

describe('a cascade across several shelves', () => {
  /**
   * Apply one overflow the way the server does, returning the new separators.
   *
   * The point of doing it properly rather than asserting on a single step:
   * a shimmy down a full bookcase is a chain of these, and each one has to
   * leave the run in a state the next one can act on.
   */
  const apply = (
    books: { id: number; sortKey: string }[],
    separators: Separator[],
    label: string,
    kind: 'shelf' | 'area' = 'area',
  ) => {
    const step = overflow(layoutRange(books, separators), separators, label, kind)
    if (!step) return { step: null, separators }
    if (step.create) {
      return {
        step,
        separators: [...separators, {
          id: Math.max(0, ...separators.map((s) => s.id)) + 1,
          range: 'fiction' as const,
          kind: step.create.kind,
          startsAt: step.create.startsAt,
          position: separators.length,
        }],
      }
    }
    return {
      step,
      separators: separators.map((s) =>
        s.id === step.shift?.id ? { ...s, startsAt: step.shift.startsAt } : s),
    }
  }

  it('shimmies one book along each of three full shelves', () => {
    const books = run('ABCDEFGHI')
    // Three shelves of three: ABC / DEF / GHI.
    let separators: Separator[] = [sep(1, 'D'), sep(2, 'G')]
    expect(labels(books, separators)).toEqual(
      ['1A', '1A', '1A', '1B', '1B', '1B', '1C', '1C', '1C'])

    // 1A is full, so C goes to 1B.
    const first = apply(books, separators, '1A')
    expect(first.step!.moved.sortKey).toBe('C')
    expect(first.step!.to).toBe('1B')
    separators = first.separators

    // 1B was full too, so its last book, F, goes on to 1C.
    const second = apply(books, separators, '1B')
    expect(second.step!.moved.sortKey).toBe('F')
    expect(second.step!.to).toBe('1C')
    separators = second.separators

    // 1C in turn pushes I onto a shelf that does not exist yet.
    const third = apply(books, separators, '1C')
    expect(third.step!.moved.sortKey).toBe('I')
    expect(third.step!.to).toBe('1D')
    expect(third.step!.create).toEqual({ startsAt: 'I', kind: 'area' })
    separators = third.separators

    // Every book still present, still in order, one per shelf as expected.
    expect(labels(books, separators)).toEqual(
      ['1A', '1A', '1B', '1B', '1B', '1C', '1C', '1C', '1D'])
  })

  it('loses nothing and reorders nothing however deep the chain goes', () => {
    const books = run('ABCDEFGHIJKL')
    let separators: Separator[] = [sep(1, 'D'), sep(2, 'G'), sep(3, 'J')]

    for (const label of ['1A', '1B', '1C', '1D']) {
      separators = apply(books, separators, label).separators
    }

    const placed = layoutRange(books, separators)
    // The invariant that matters: a shimmy moves boundaries, never books.
    expect(placed.map((p) => p.book.sortKey).join('')).toBe('ABCDEFGHIJKL')
    expect(placed).toHaveLength(12)
    // And each shelf is still a contiguous run, which is what makes the
    // alphabet findable on a real shelf.
    const byLabel = new Map<string, string[]>()
    for (const p of placed) {
      byLabel.set(p.label, [...(byLabel.get(p.label) ?? []), p.book.sortKey])
    }
    for (const [, keys] of byLabel) {
      expect([...keys].sort()).toEqual(keys)
    }
  })

  it('stops rather than emptying a shelf that is down to one book', () => {
    // The end of a cascade: nothing left to give, so the chain has to stop
    // and the person is told to start a new shelf instead.
    const books = run('ABC')
    const separators: Separator[] = [sep(1, 'B'), sep(2, 'C')]
    expect(labels(books, separators)).toEqual(['1A', '1B', '1C'])
    expect(apply(books, separators, '1B').step).toBeNull()
  })

  it('carries a chain into a new bookcase when asked', () => {
    const books = run('ABCDEF')
    let separators: Separator[] = [sep(1, 'D')]

    const step = apply(books, separators, '1A', 'shelf')
    expect(step.step!.to).toBe('2A')
    separators = step.separators
    // The plank break that followed now divides the new bookcase, so the run
    // past it comes along rather than being stranded in bookcase one.
    expect(labels(books, separators)).toEqual(['1A', '1A', '2A', '2B', '2B', '2B'])
  })
})
