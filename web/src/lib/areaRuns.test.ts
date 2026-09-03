import { describe, expect, it } from 'vitest'
import { areaRuns } from './areaRuns'
import type { AreaStanding } from '../../shared/shelving'
import type { BookState } from '../../domain/books/state'

/** A piece nobody has named, standing where it stands. */
const at = (
  fixture: number,
  plank: number,
  more: Partial<AreaStanding> = {},
): AreaStanding => ({ fixtureId: fixture, fixture, plank, name: '', kind: 'bookshelf', ...more })

const book = (id: number, areaId: number, location: string, standing: AreaStanding) =>
  ({ id, area_id: areaId, location, standing, state: 'shelved' as BookState })

/**
 * A book nobody has put anywhere, and why not.
 *
 * The reason is a parameter since #459: the three of them used to be one count
 * and one sentence, and only one of the three is a book somebody can go and
 * fetch. `shelved` with no area is the never-placed, which is what this
 * defaulted to being before the state was asked for at all.
 */
const nowhere = (id: number, state: BookState = 'shelved') =>
  ({ id, area_id: null, location: '', standing: null, state })

describe('cutting a listing into the rows a bookcase has', () => {
  it('makes one board per area, in the order the books arrived on it', () => {
    const { runs } = areaRuns(
      [
        book(1, 10, '1A', at(1, 0)),
        book(2, 10, '1A', at(1, 0)),
        book(3, 11, '1B', at(1, 1)),
        book(4, 20, '2C', at(2, 2)),
      ],
      true,
    )

    expect(runs.map((run) => run.label)).toEqual(['1A', '1B', '2C'])
    expect(runs[0]!.books.map((one) => one.id)).toEqual([1, 2])
  })

  /*
   * #434, and the reason a board is an area rather than a stretch of the
   * listing.
   *
   * A book retagged from non-fiction to fiction files into the other run at
   * once and goes on standing exactly where it was, so the listing hands it
   * over between two fiction books while its recorded plank is on the
   * non-fiction bookcase. Cut where the label changes, that drew "Bookcase 4 /
   * 4B, 1 book" between bookcase 1 and bookcase 2, with 4B drawn again further
   * down holding the rest. One area, two boards, two counts.
   */
  it('draws the area a retagged book stands on once, where it stands', () => {
    const { runs } = areaRuns(
      [
        book(1, 10, '1A', at(1, 0)),
        book(2, 11, '1B', at(1, 1)),
        book(3, 46, '4B', at(4, 1)),
        book(4, 20, '2A', at(2, 0)),
        book(5, 46, '4B', at(4, 1)),
        book(6, 46, '4B', at(4, 1)),
      ],
      true,
    )

    expect(runs.map((run) => run.label)).toEqual(['1A', '1B', '2A', '4B'])
    expect(runs.filter((run) => run.label === '4B')).toHaveLength(1)
    expect(runs[3]!.books.map((one) => one.id)).toEqual([3, 5, 6])
  })

  it('puts the boards in the order the furniture stands, not the order they arrived', () => {
    const { runs } = areaRuns(
      [
        book(1, 20, '2A', at(2, 0)),
        book(2, 11, '1B', at(1, 1)),
        book(3, 10, '1A', at(1, 0)),
      ],
      true,
    )

    expect(runs.map((run) => run.label)).toEqual(['1A', '1B', '2A'])
  })

  /*
   * This catalogue has two pieces standing on number 4, which `slotsInOrder`
   * and the ordering column both take care to keep apart. Unnamed they read the
   * same, and they are still two bookcases.
   */
  it('keeps two pieces standing on one number apart', () => {
    const { runs } = areaRuns(
      [
        book(1, 40, '4A', { ...at(4, 0), fixtureId: 7 }),
        book(2, 50, '4A', { ...at(4, 0), fixtureId: 9 }),
      ],
      true,
    )

    expect(runs).toHaveLength(2)
    expect(runs.map((run) => run.standing.fixtureId)).toEqual([7, 9])
  })

  it('leaves a book that is not on a bookcase out, and counts it', () => {
    const { runs, off } = areaRuns(
      [book(1, 10, '1A', at(1, 0)), nowhere(2), book(3, 10, '1A', at(1, 0))],
      true,
    )

    expect(off.total).toBe(1)
    // And it does not split the area either side of it: the run has closed up
    // behind the missing book exactly as the shelf has.
    expect(runs).toHaveLength(1)
    expect(runs[0]!.books.map((one) => one.id)).toEqual([1, 3])
  })

  /**
   * Three reasons a book is off a bookcase, counted apart (#459).
   *
   * They were one number and one sentence, "3 books are not on a bookcase", and
   * only one of the three is a book somebody can walk out and fetch. The
   * library says the lending one as a door into those books and the other two
   * as words, so a count that has an answer and a count that has none do not
   * read the same.
   */
  it('counts the three reasons a book is off a bookcase apart', () => {
    const { off } = areaRuns(
      [
        book(1, 10, '1A', at(1, 0)),
        nowhere(2, 'checked_out'),
        nowhere(3, 'checked_out'),
        nowhere(4, 'withdrawn'),
        nowhere(5),
      ],
      true,
    )

    expect(off).toEqual({ out: 2, gone: 1, unplaced: 1, total: 4 })
  })

  it('closes every board when everything has loaded', () => {
    const { runs } = areaRuns([book(1, 10, '1A', at(1, 0)), book(2, 11, '1B', at(1, 1))], true)
    expect(runs.every((run) => run.closed)).toBe(true)
  })

  /*
   * The one thing paging costs the drawing. A board is a place rather than a
   * stretch of the filing order, so any of them can still gain a book from a
   * later page and a count over any of them would be wrong until somebody
   * pressed More.
   */
  it('closes no board while there is more to load', () => {
    const { runs } = areaRuns([book(1, 10, '1A', at(1, 0)), book(2, 11, '1B', at(1, 1))], false)
    expect(runs.some((run) => run.closed)).toBe(false)
  })

  it('has nothing to say about no books', () => {
    expect(areaRuns([], false))
      .toEqual({ runs: [], off: { out: 0, gone: 0, unplaced: 0, total: 0 } })
  })
})

describe('what the heading over a board says', () => {
  it('says which bookcase, where nobody has named one', () => {
    const { runs } = areaRuns([book(1, 10, '1A', at(1, 0))], true)
    expect(runs[0]!.piece).toBe('Bookcase 1')
  })

  it('says what somebody called it, where they have', () => {
    const { runs } = areaRuns(
      [book(1, 10, 'Hall shelf · Cookery', at(1, 0, { name: 'Hall shelf' }))],
      true,
    )
    expect(runs[0]!.piece).toBe('Hall shelf')
  })

  /*
   * The word "Bookcase" is not a fact about a piece of furniture, and the piece
   * says what it is. Reading the heading back out of the label could only ever
   * answer one word for all five of them.
   */
  it('calls a crate a crate', () => {
    const { runs } = areaRuns([book(1, 10, '5A', at(5, 0, { kind: 'crate' }))], true)
    expect(runs[0]!.piece).toBe('Crate 5')
  })
})
