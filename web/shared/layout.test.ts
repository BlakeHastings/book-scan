import { describe, expect, it } from 'vitest'
import {
  areaIndex, areaLabel, boundaryMove, carryOn, groupByShelf, layoutRange, libraryRows,
  locationLabel, NEWCOMER_ID, overflow, shelfLoads, stripAt, stripAround,
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

  it('reads a plank letter back to the plank it names', () => {
    // The inverse the placement ledger needs, because `books.location` holds a
    // label and an area is a row: `1A` has to become the first area of the first
    // fixture again. Asserted over the whole round trip rather than at three
    // points, because bijective base 26 goes wrong at exactly the boundaries a
    // handful of examples step over.
    for (let plank = 0; plank < 800; plank += 1) {
      expect(areaIndex(areaLabel(plank))).toBe(plank)
    }
    expect(areaIndex('a')).toBe(0)
  })

  it('has no index for a bookcase with no plank on it', () => {
    // `S4` parses as a location and names no plank, so it is not plank A. Two
    // different places, and `compareLocations` already sorts them apart.
    expect(areaIndex('')).toBe(-1)
    expect(areaIndex('4A')).toBe(-1)
    expect(areaIndex(' A')).toBe(-1)
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

  it('empties a shelf holding a single book, which is how the gap is opened', () => {
    /*
     * It used to refuse, on the reasoning that moving the only book along would
     * leave the shelf empty and solve nothing (#432). Emptying it is what solves
     * it: the gap the person needs is on this plank, and on a plank holding one
     * book the gap is the whole plank. `docs/shelving.md` allows exactly this of
     * a boundary moved by hand, and says the hand and the cascade write the same
     * thing down.
     */
    const separators = [sep(1, 'B')]
    const step = overflow(layoutRange(run('AB'), separators), separators, '1A')!
    expect(step.moved.sortKey).toBe('A')
    expect(step).toMatchObject({ from: '1A', to: '1B', shift: { id: 1, startsAt: 'A' } })

    // A is on 1B beside B, 1A has nothing to name it, and a book sorting before
    // A now lands on the plank that has been cleared for it.
    const after = [{ ...separators[0]!, startsAt: step.shift!.startsAt }]
    expect(labels(run('AB'), after)).toEqual(['1B', '1B'])
    expect(labels(run('0AB'), after)).toEqual(['1A', '1B', '1B'])
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
    expect(groups[1]).toMatchObject({ opensWith: { id: 7, kind: 'shelf' } })
    expect(groups[0]).toMatchObject({ opensWith: null })
  })

  /**
   * The order the library is drawn in, which is why this is data and not a
   * decision taken inside a component (#145). A line names the boundary it
   * removes, so it belongs above the heading of the area that boundary opens.
   */
  it('draws each boundary line above the heading it opens', () => {
    const separators = [sep(1, 'B'), sep(2, 'C', 'shelf')]
    const groups = groupByShelf(layoutRange(run('ABCD'), separators), separators)

    expect(libraryRows(groups).map((row) =>
      row.row === 'divider' ? `${row.notice} (${row.separatorId})` : row.group.label))
      .toEqual([
        '1A',
        'New area starts here (1)', '1B',
        'New bookcase starts here (2)', '2A',
      ])
  })

  it('names the area each line opens, which is the heading beneath it', () => {
    const separators = [sep(1, 'B'), sep(2, 'C', 'shelf')]
    const groups = groupByShelf(layoutRange(run('ABCD'), separators), separators)

    expect(libraryRows(groups)
      .filter((row) => row.row === 'divider')
      .map((row) => (row.row === 'divider' ? row.opens : '')))
      .toEqual(['1B', '2A'])
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

  it('walks on through a shelf that is down to one book', () => {
    /*
     * This used to be where a chain stopped: nothing left to give, so the person
     * was told to start a new shelf instead, by a screen with no such answer on
     * it (#432). The plank gives up its one book like any other, and what it
     * leaves behind is a bare plank for the book coming the other way, which is
     * the same arrangement a boundary moved by hand produces.
     */
    const books = run('ABC')
    const separators: Separator[] = [sep(1, 'B'), sep(2, 'C')]
    expect(labels(books, separators)).toEqual(['1A', '1B', '1C'])

    const walked = apply(books, separators, '1B')
    expect(walked.step!.moved.sortKey).toBe('B')
    expect(walked.step!.to).toBe('1C')
    expect(labels(books, walked.separators)).toEqual(['1A', '1C', '1C'])
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

describe('boundaryMove', () => {
  /**
   * Apply the planned move to a separator list, the way the store does, so a
   * test can assert on the labels that come out rather than on the edit that
   * was planned. The edit is a means; the run of labels is the claim.
   */
  const carry = (
    books: { id: number; sortKey: string }[],
    separators: Separator[],
    id: number,
    direction: 'next' | 'previous',
  ) => {
    const outcome = boundaryMove(layoutRange(books, separators), separators, id, direction)
    if (!outcome.ok) return { outcome, separators }

    const shifted = new Map(outcome.move.shift.map((s) => [s.id, s.startsAt]))
    return {
      outcome,
      separators: separators
        .filter((s) => !outcome.move.remove.includes(s.id))
        .map((s) => (shifted.has(s.id) ? { ...s, startsAt: shifted.get(s.id)! } : s)),
    }
  }

  const refusal = (
    books: { id: number; sortKey: string }[],
    separators: Separator[],
    id: number,
    direction: 'next' | 'previous',
  ) => {
    const outcome = boundaryMove(layoutRange(books, separators), separators, id, direction)
    return outcome.ok ? '' : outcome.reason
  }

  it('sends the last book of an area to the front of the next one', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C')]
    expect(labels(books, separators)).toEqual(['1A', '1A', '1B', '1B'])

    const { outcome, separators: after } = carry(books, separators, 2, 'next')
    expect(outcome.ok && outcome.move.from).toBe('1A')
    expect(outcome.ok && outcome.move.to).toBe('1B')
    expect(labels(books, after)).toEqual(['1A', '1B', '1B', '1B'])
  })

  it('sends the first book of an area to the end of the previous one', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C')]

    const { outcome, separators: after } = carry(books, separators, 3, 'previous')
    expect(outcome.ok && outcome.move.from).toBe('1B')
    expect(outcome.ok && outcome.move.to).toBe('1A')
    expect(labels(books, after)).toEqual(['1A', '1A', '1A', '1B'])
  })

  it('leaves every other book exactly where it was', () => {
    // The property the whole restriction exists for. A move that shuffled the
    // neighbours would be a general move with a guard on it, not this.
    const books = run('ABCDEF')
    const separators = [sep(1, 'C'), sep(2, 'E')]
    const was = labels(books, separators)

    const { separators: after } = carry(books, separators, 4, 'next')
    expect(labels(books, after)).toEqual(was.map((label, i) => (i === 3 ? '1C' : label)))
  })

  it('refuses a book in the middle of its area, both ways', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C')]
    expect(refusal(books, separators, 1, 'next')).toBe('not-at-boundary')
    expect(refusal(books, separators, 4, 'previous')).toBe('not-at-boundary')
  })

  it('refuses the first book of the first area and the last of the last', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C')]
    expect(refusal(books, separators, 1, 'previous')).toBe('no-adjacent-area')
    expect(refusal(books, separators, 4, 'next')).toBe('no-adjacent-area')
  })

  it('refuses a book that is not in this run at all', () => {
    expect(refusal(run('AB'), [], 99, 'next')).toBe('not-shelved')
  })

  it('empties an area when its only book moves on, and moves nothing else', () => {
    // B has a plank to itself. Carrying it to the next one leaves that plank
    // bare, which is exactly what happened in the room.
    const books = run('ABC')
    const separators = [sep(1, 'B'), sep(2, 'C')]
    expect(labels(books, separators)).toEqual(['1A', '1B', '1C'])

    const { separators: after } = carry(books, separators, 2, 'next')
    expect(labels(books, after)).toEqual(['1A', '1C', '1C'])
  })

  it('empties an area when its only book moves back, and moves nothing else', () => {
    const books = run('ABC')
    const separators = [sep(1, 'B'), sep(2, 'C')]

    const { separators: after } = carry(books, separators, 2, 'previous')
    expect(labels(books, after)).toEqual(['1A', '1A', '1C'])
  })

  it('drops the boundary when the area it starts has nothing left after it', () => {
    // C is alone on the last plank. Moved back, no book is left for that
    // boundary to be anchored to, so it describes nowhere and goes.
    const books = run('ABC')
    const separators = [sep(1, 'C')]

    const { outcome, separators: after } = carry(books, separators, 3, 'previous')
    expect(outcome.ok && outcome.move.remove).toEqual([1])
    expect(after).toEqual([])
    expect(labels(books, after)).toEqual(['1A', '1A', '1A'])
  })

  it('carries the book one plank even when an emptied one is in the way', () => {
    // Two boundaries anchored to the same book is what an emptied area looks
    // like. Re-anchoring only one of them would carry the book two planks.
    const books = run('ABC')
    const separators = [sep(1, 'C'), sep(2, 'C')]
    expect(labels(books, separators)).toEqual(['1A', '1A', '1C'])

    const { outcome, separators: after } = carry(books, separators, 2, 'next')
    expect(outcome.ok && outcome.move.to).toBe('1C')
    expect(labels(books, after)).toEqual(['1A', '1C', '1C'])
  })

  it('leaves a bare plank a later overflow can fill, and name correctly', () => {
    // The two features meeting. A boundary move can empty a plank, and an
    // empty plank has no books to name it, so it is absent from the groups.
    // An overflow that read its destination off "the next group" would then
    // send a book to the plank after the bare one and record it there, which
    // is a misfile the app manufactured on its own.
    const books = run('ABC')
    const separators = [sep(1, 'B'), sep(2, 'C')]
    const { separators: after } = carry(books, separators, 2, 'previous')
    expect(labels(books, after)).toEqual(['1A', '1A', '1C'])

    const step = overflow(layoutRange(books, after), after, '1A', 'area')
    const filled = after.map((s) =>
      s.id === step?.shift?.id ? { ...s, startsAt: step.shift!.startsAt } : s)

    expect(step?.to).toBe('1B')
    expect(labels(books, filled)).toEqual(['1A', '1B', '1C'])
    expect(step?.to).toBe(labels(books, filled)[1])
  })

  it('crosses a bookcase boundary the same way it crosses a plank', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C', 'shelf')]
    expect(labels(books, separators)).toEqual(['1A', '1A', '2A', '2A'])

    const { outcome, separators: after } = carry(books, separators, 2, 'next')
    expect(outcome.ok && outcome.move.to).toBe('2A')
    expect(labels(books, after)).toEqual(['1A', '2A', '2A', '2A'])
  })

  it('sends the first book of 2A back to the last area of bookcase 1', () => {
    /*
     * Within a range the areas are one continuous sequence, and a bookcase
     * boundary is only where that sequence breaks across furniture. So the
     * first book of 2A goes back to 1E, and it is the bookcase break that
     * moves, not a plank break: everything after it stays on bookcase 2 at the
     * area it was on.
     */
    const books = run('ABCDEFG')
    const separators = [
      sep(1, 'B'), sep(2, 'C'), sep(3, 'D'), sep(4, 'E'),
      sep(5, 'F', 'shelf'), sep(6, 'G'),
    ]
    expect(labels(books, separators)).toEqual(['1A', '1B', '1C', '1D', '1E', '2A', '2B'])

    const { outcome, separators: after } = carry(books, separators, 6, 'previous')
    expect(outcome.ok && outcome.move.from).toBe('2A')
    expect(outcome.ok && outcome.move.to).toBe('1E')
    /*
     * F joins 1E and G keeps 2B, which is the bare-plank case from #76 seen at
     * a bookcase break: F was the only book on 2A, so 2A is now empty, and an
     * empty plank has no books to name it. Nothing shuffles up to fill it, and
     * that is the point: the books past the break are not disturbed.
     */
    expect(labels(books, after)).toEqual(['1A', '1B', '1C', '1D', '1E', '1E', '2B'])

    // The bookcase break, and only it, was re-anchored.
    expect(after.find((s) => s.id === 5)).toEqual({ ...sep(5, 'G', 'shelf') })
    expect(after.filter((s) => s.kind === 'area').map((s) => s.startsAt))
      .toEqual(['B', 'C', 'D', 'E', 'G'])
  })

  it('leaves the books past a bookcase break where they were', () => {
    // The other half of the same claim, with more than one book on 2A: the
    // book moves back a bookcase and its old neighbours do not follow it.
    const books = run('ABC')
    const separators = [sep(1, 'B', 'shelf')]
    expect(labels(books, separators)).toEqual(['1A', '2A', '2A'])

    const { outcome, separators: after } = carry(books, separators, 2, 'previous')
    expect(outcome.ok && outcome.move.to).toBe('1A')
    expect(labels(books, after)).toEqual(['1A', '1A', '2A'])
    expect(after.map((s) => `${s.kind}@${s.startsAt}`)).toEqual(['shelf@C'])
  })

  it('still refuses at the two ends of the range, not at every bookcase', () => {
    // Making new furniture is what declaring a plank full is for, and that
    // reasoning applies to the start and end of the run, not to a break
    // between two bookcases that both already exist.
    const books = run('ABC')
    const separators = [sep(1, 'B', 'shelf'), sep(2, 'C', 'shelf')]
    expect(labels(books, separators)).toEqual(['1A', '2A', '3A'])

    expect(refusal(books, separators, 1, 'previous')).toBe('no-adjacent-area')
    expect(refusal(books, separators, 3, 'next')).toBe('no-adjacent-area')
    // And the bookcase break in the middle is crossable both ways.
    expect(refusal(books, separators, 2, 'previous')).toBe('')
    expect(refusal(books, separators, 2, 'next')).toBe('')
  })

  it('writes the same boundary an overflow of the same shelf would', () => {
    // A manual bounce and an automatic shuffle answer the same physical
    // question. If they wrote different things down, one would quietly undo
    // the other every time both were used on one run.
    const books = run('ABCD')
    const separators = [sep(1, 'C')]

    const step = overflow(layoutRange(books, separators), separators, '1A', 'area')
    const shuffled = separators.map((s) =>
      s.id === step?.shift?.id ? { ...s, startsAt: step.shift!.startsAt } : s)

    expect(labels(books, carry(books, separators, 2, 'next').separators))
      .toEqual(labels(books, shuffled))
  })
})

describe('carryOn', () => {
  /** The run as the placing step sees it, with the unsaved book slotted in. */
  const placing = (
    books: { id: number; sortKey: string }[],
    separators: Separator[],
    sortKey: string,
  ) =>
    layoutRange(
      [...books, { id: NEWCOMER_ID, sortKey }]
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0)),
      separators,
    )

  /** Apply the plan, the way the store does, and lay the run out again. */
  const applied = (
    books: { id: number; sortKey: string }[],
    separators: Separator[],
    sortKey: string,
    plan: NonNullable<ReturnType<typeof carryOn>>,
  ) => {
    const next = plan.create
      ? [...separators, sep(
          Math.max(0, ...separators.map((s) => s.id)) + 1,
          plan.create.startsAt,
          plan.create.kind,
        )]
      : separators.map((s) =>
          s.id === plan.shift?.id ? { ...s, startsAt: plan.shift.startsAt } : s)
    return placing(books, next, sortKey)
  }

  /** Where every book, saved or not, ends up. */
  const where = (placed: ReturnType<typeof placing>) =>
    placed.map((p) => `${p.book.id === NEWCOMER_ID ? 'new' : p.book.id}${p.label}`)

  it('sends the book in your hand on when it belongs at the end', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C')]
    const before = where(placing(books, separators, 'BB'))
    expect(before).toEqual(['11A', '21A', 'new1A', '31B', '41B'])

    const plan = carryOn(placing(books, separators, 'BB'), separators, '1A', 'area')
    expect(plan).toEqual({
      from: '1A', to: '1B',
      fromAt: { shelf: 1, area: 0 }, toAt: { shelf: 1, area: 1 },
      shift: { id: 1, startsAt: 'BB' },
    })

    // The book moves and nothing already shelved does, which is the whole
    // point: the person is holding the one that has to go somewhere else.
    expect(where(applied(books, separators, 'BB', plan!)))
      .toEqual(['11A', '21A', 'new1B', '31B', '41B'])
  })

  it('declines when the gap is in the middle, so the cascade runs', () => {
    // Something on the plank really does sort after the book, so a gap has to
    // be opened and a book has to come off the end to open it.
    const books = run('ABCD')
    const separators = [sep(1, 'C')]
    expect(carryOn(placing(books, separators, 'AA'), separators, '1A', 'area')).toBeNull()
  })

  it('declines for a plank the book is not going on', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C')]
    expect(carryOn(placing(books, separators, 'BB'), separators, '1B', 'area')).toBeNull()
  })

  it('makes the plank when the book is last in the whole run', () => {
    // The end of the last area of the last bookcase. There is nothing to
    // displace and nowhere to displace it to, so the plank gets made and the
    // book is the only thing on it.
    const books = run('AB')
    const plan = carryOn(placing(books, [], 'C'), [], '1A', 'area')
    expect(plan).toEqual({
      from: '1A', to: '1B',
      fromAt: { shelf: 1, area: 0 }, toAt: { shelf: 1, area: 1 },
      create: { startsAt: 'C', kind: 'area' },
    })
    expect(where(applied(books, [], 'C', plan!))).toEqual(['11A', '21A', 'new1B'])
  })

  it('starts a whole new bookcase when that is what was asked for', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C', 'area')]
    const plan = carryOn(placing(books, separators, 'BB'), separators, '1A', 'shelf')

    // A boundary of its own, inserted before the plank break, or the book
    // would stay in this bookcase, which is the opposite of what was asked.
    expect(plan?.to).toBe('2A')
    expect(plan?.create).toEqual({ startsAt: 'BB', kind: 'shelf' })
    expect(where(applied(books, separators, 'BB', plan!)))
      .toEqual(['11A', '21A', 'new2A', '32B', '42B'])
  })

  it('crosses a bookcase break the same way it crosses a plank break', () => {
    const books = run('ABCD')
    const separators = [sep(1, 'C', 'shelf')]
    const plan = carryOn(placing(books, separators, 'BB'), separators, '1A', 'area')
    expect(plan?.to).toBe('2A')
    expect(where(applied(books, separators, 'BB', plan!)))
      .toEqual(['11A', '21A', 'new2A', '32A', '42A'])
  })

  it('puts it on a bare plank rather than skipping past one', () => {
    // Two boundaries on one anchor is what a plank emptied by a boundary move
    // looks like. A book with nowhere to go belongs on the empty one.
    const books = run('ABC')
    const separators = [sep(1, 'C'), sep(2, 'C')]
    expect(labels(books, separators)).toEqual(['1A', '1A', '1C'])

    const plan = carryOn(placing(books, separators, 'BB'), separators, '1A', 'area')
    expect(plan?.to).toBe('1B')
    expect(where(applied(books, separators, 'BB', plan!)))
      .toEqual(['11A', '21A', 'new1B', '31C'])
  })

  it('is never reached for a book that lands first on a plank', () => {
    /*
     * The mirror case, and it does not arise. A boundary is anchored to the
     * sort key of the first book on its plank, so a book landing on that
     * plank at all sorts at or after that anchor, which puts it at or after
     * the book the anchor names. There is no key that lands first on a plank
     * whose anchor is a book still on it.
     */
    const books = run('ACEG')
    const separators = [sep(1, 'C'), sep(2, 'E', 'shelf'), sep(3, 'G')]

    for (const key of ['AA', 'B', 'BB', 'CC', 'D', 'DD', 'EE', 'F', 'FF', 'H']) {
      const placed = placing(books, separators, key)
      const index = placed.findIndex((p) => p.book.id === NEWCOMER_ID)
      const first = index === 0 || placed[index - 1]!.label !== placed[index]!.label
      expect(first && index > 0, `${key} landed first on a plank`).toBe(false)
    }
  })

  it('declines when an orphaned anchor does put it first, leaving the cascade', () => {
    /*
     * The one way to land first on a plank: an anchor naming a book that is no
     * longer on it, because it was deleted or taken off the bookcase. Going
     * back to the previous plank is not the answer there. It is a plank the
     * person was not asked about, and after a carry the anchor is the book in
     * hand, so treating "first" as "go back" would undo the hop that had just
     * been made and ask the same question forever.
     */
    const books = run('AD')
    const separators = [sep(1, 'B')]           // B has since gone
    const placed = placing(books, separators, 'C')
    expect(where(placed)).toEqual(['11A', 'new1B', '21B'])

    expect(carryOn(placed, separators, '1B', 'area')).toBeNull()
  })
})
