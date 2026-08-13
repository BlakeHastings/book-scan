import { describe, expect, it } from 'vitest'
import { areaRuns, pieceOf } from './areaRuns'

const book = (id: number, location: string) => ({ id, location })

describe('cutting a listing into the rows a bookcase has', () => {
  it('makes one run of books next to each other under one label', () => {
    const { runs } = areaRuns(
      [book(1, '1A'), book(2, '1A'), book(3, '1B'), book(4, '2C')],
      true,
    )

    expect(runs.map((run) => run.label)).toEqual(['1A', '1B', '2C'])
    expect(runs[0]!.books.map((one) => one.id)).toEqual([1, 2])
  })

  /*
   * The state a misfiled book is in, and the reason a run is consecutive rather
   * than gathered. Two stretches of 1A with a 1B book between them are two rows
   * on the drawing because that is what the bookcase looks like.
   */
  it('does not gather two stretches of one label into one row', () => {
    const { runs } = areaRuns([book(1, '1A'), book(2, '1B'), book(3, '1A')], true)
    expect(runs.map((run) => run.label)).toEqual(['1A', '1B', '1A'])
  })

  it('leaves a book that is not on a bookcase out, and counts it', () => {
    const { runs, off } = areaRuns([book(1, '1A'), book(2, ''), book(3, '1A')], true)

    expect(off).toBe(1)
    // And it does not split the area either side of it: the run has closed up
    // behind the missing book exactly as the shelf has.
    expect(runs).toHaveLength(1)
    expect(runs[0]!.books.map((one) => one.id)).toEqual([1, 3])
  })

  it('closes every run when everything has loaded', () => {
    const { runs } = areaRuns([book(1, '1A'), book(2, '1B')], true)
    expect(runs.every((run) => run.closed)).toBe(true)
  })

  /*
   * The one thing paging costs the drawing. The last run of a partial load is
   * usually half an area, and a count over it would be wrong until somebody
   * scrolls.
   */
  it('leaves the last run open while there is more to load', () => {
    const { runs } = areaRuns([book(1, '1A'), book(2, '1B')], false)

    expect(runs[0]!.closed).toBe(true)
    expect(runs[1]!.closed).toBe(false)
  })

  it('has nothing to say about no books', () => {
    expect(areaRuns([], false)).toEqual({ runs: [], off: 0 })
  })
})

describe('what the heading over a row of books says', () => {
  it('says which bookcase, where nobody has named one', () => {
    expect(pieceOf('1A')).toBe('Bookcase 1')
    expect(pieceOf('12C')).toBe('Bookcase 12')
  })

  it('says what somebody called it, where they have', () => {
    expect(pieceOf('Hall shelf · Cookery')).toBe('Hall shelf')
    expect(pieceOf('Hall shelf · B')).toBe('Hall shelf')
  })

  it('says the label back rather than inventing a bookcase for it', () => {
    expect(pieceOf('somewhere')).toBe('somewhere')
  })
})
