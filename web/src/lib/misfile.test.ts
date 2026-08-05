/**
 * The misfile flag as the book's own page reads it.
 *
 * Two things only, and both are the ones a comparison written by hand would
 * get wrong: which entry of the server's review belongs to this book, and what
 * confirming actually writes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { findMisfile, recordMoved } from './misfile'
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
