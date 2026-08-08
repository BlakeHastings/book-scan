/**
 * The misfile flag as the book's own page reads it.
 *
 * Two things only, and both are the ones a comparison written by hand would
 * get wrong: which entry of the server's review belongs to this book, and what
 * confirming actually writes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { canTakeBack, findMisfile, recordMoved, takeMoveBack } from './misfile'
import type { Misfile, ShelvingReview } from './api'

const flagged = (id: number, from: string, to: string): Misfile => ({
  book: {
    id,
    title: `Book ${id}`,
    authorFiling: 'Herbert, Frank',
    location: from,
    derivedLocation: to,
    sortKey: `herbert frank book ${id}`,
    checkedOut: false,
  },
  from,
  to,
  instruction: `Move Book ${id} from ${from} to ${to}`,
})

const review = (...misfiles: Misfile[]): ShelvingReview => ({ misfiles, excluded: [] })

describe('findMisfile', () => {
  it('picks this book out of the review the library already reads', () => {
    const found = findMisfile(review(flagged(7, 'A1', 'A2'), flagged(9, 'B3', 'B4')), 9)
    expect(found?.from).toBe('B3')
    expect(found?.to).toBe('B4')
  })

  it('reports nothing for a book the server did not flag', () => {
    expect(findMisfile(review(flagged(7, 'A1', 'A2')), 12)).toBeNull()
  })

  /*
   * A checked-out book and a book never confirmed onto a shelf are excluded by
   * reviewShelving rather than listed, so they arrive here as an absence. The
   * client must not read that absence as anything other than "not flagged",
   * which is exactly what an entry-not-found means.
   */
  it('reports nothing for a book the server excluded from the judgement', () => {
    const excluded: ShelvingReview = {
      misfiles: [],
      excluded: [{ book: flagged(7, 'A1', 'A2').book, reason: 'checked-out' }],
    }
    expect(findMisfile(excluded, 7)).toBeNull()
  })

  it('reports nothing before the review has arrived, and for an unsaved book', () => {
    expect(findMisfile(null, 7)).toBeNull()
    expect(findMisfile(review(flagged(7, 'A1', 'A2')), null)).toBeNull()
  })
})

describe('recordMoved', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /*
   * The single write this feature makes, checked against the wire rather than
   * against a mock of the client: confirming has to reach the one endpoint
   * that changes a recorded location, carrying the shelf the book was carried
   * TO. Writing anything else, or writing nothing, loses the only record of
   * where the book physically is.
   */
  it('writes the shelf the book was carried to, through the location endpoint', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ book: {} }) })
    })

    await recordMoved(flagged(7, 'A1', 'B2'))

    const [call] = calls
    expect(calls).toHaveLength(1)
    expect(call?.path).toBe('/api/books/7/location')
    expect(call?.init?.method).toBe('PATCH')
    expect(JSON.parse(String(call?.init?.body))).toEqual({ location: 'B2' })
  })
})

/**
 * The second question about a flagged book, and it is not the same question.
 *
 * "Where is it against where it belongs" is `findMisfile`. "Did this app put it
 * there" is this, and only the second one can be withdrawn: a book pushed along
 * by a newcomer is a real misfile with no assignment behind it, and offering to
 * undo it would move the furniture on somebody's behalf.
 */
describe('canTakeBack', () => {
  const answered = (misfiles: Misfile[], outstandingMoves: number[]) =>
    ({ misfiles, excluded: [], outstandingMoves })

  it('says yes only for a book the server listed as an outstanding move', () => {
    const review = answered([flagged(7, 'A1', 'A2'), flagged(9, 'B3', 'B4')], [9])
    expect(canTakeBack(review, 9)).toBe(true)
    expect(canTakeBack(review, 7)).toBe(false)
  })

  it('says no before the review has arrived, and for an unsaved book', () => {
    expect(canTakeBack(null, 7)).toBe(false)
    expect(canTakeBack(answered([flagged(7, 'A1', 'A2')], [7]), null)).toBe(false)
  })
})

describe('takeMoveBack', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /*
   * The mirror of the assertion above, and the reason this is a separate call
   * rather than `recordMoved` with a different label: withdrawing a move must
   * not write a location, because nobody carried the book anywhere. A retraction
   * that reached the location endpoint would record the walk it exists to avoid
   * claiming.
   */
  it('reaches the retraction, and never the location endpoint', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      calls.push(`${String(init?.method ?? 'GET')} ${path}`)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ move: null }) })
    })

    await takeMoveBack('fiction', 7)

    expect(calls).toEqual(['POST /api/shelves/retract'])
  })
})
