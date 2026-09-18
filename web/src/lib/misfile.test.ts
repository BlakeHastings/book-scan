/**
 * The misfile flag as the book's own page reads it.
 *
 * Two things only, and both are the ones a comparison written by hand would
 * get wrong: which entry of the server's review belongs to this book, and what
 * confirming actually writes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { canTakeBack, findMisfile, notChecked, recordMoved, takeMoveBack } from './misfile'
import type { ExcludedReason, Misfile, ShelvingReview } from './api'

const flagged = (id: number, from: string, to: string): Misfile => ({
  book: {
    id,
    title: `Book ${id}`,
    authorFiling: 'Herbert, Frank',
    authors: 'Frank Herbert',
    location: from,
    areaId: id * 10,
    derivedLocation: to,
    derivedAreaId: id * 10 + 1,
    standing: { fixture: 1, plank: 0 },
    sortKey: `herbert frank book ${id}`,
    checkedOut: false,
  },
  from,
  to,
  toAreaId: id * 10 + 1,
  instruction: `Move Book ${id} from ${from} to ${to}`,
  sharedNumber: null,
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

  /* A checked-out book or one never confirmed onto a shelf arrives here as an absence, meaning "not flagged", not "excluded". */
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

/** A book the check could not judge is not a book the check found fine, and an empty list must not read as the latter. */
describe('notChecked', () => {
  const aside = (...reasons: ExcludedReason[]): ShelvingReview => ({
    misfiles: [],
    excluded: reasons.map((reason, at) => ({ book: flagged(at + 1, '1A', '1B').book, reason })),
  })

  it('says nothing at all when every book was judged', () => {
    expect(notChecked(review())).toEqual({ count: 0, said: '' })
    expect(notChecked(null)).toEqual({ count: 0, said: '' })
  })

  it('says nothing for the exclusions that are about the book rather than the check', () => {
    expect(notChecked(aside('checked-out', 'never-placed')).count).toBe(0)
  })

  it('counts the books it could not judge and says so out loud', () => {
    const one = notChecked(aside('unplaceable'))
    expect(one.count).toBe(1)
    expect(one.said).toContain('One book is')

    const two = notChecked(aside('unplaceable', 'unplaceable', 'checked-out'))
    expect(two.count).toBe(2)
    expect(two.said).toContain('2 books are')
    expect(two.said).toContain('nowhere on the furniture')
  })
})

describe('recordMoved', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /**
   * The plank goes over as an id and not as the label the row showed: a label is a rendering of
   * where a piece stands and what it is called, so a row read before a bookcase was renamed would
   * ask the server to find a plank by a name it no longer answers to.
   */
  it('writes the plank the book was carried to, through the location endpoint', async () => {
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
    expect(JSON.parse(String(call?.init?.body))).toEqual({ areaId: 71 })
  })
})

/**
 * "Where is it against where it belongs" is `findMisfile`. "Did this app put it there" is this,
 * and only the second one can be withdrawn: a book pushed along by a newcomer is a real misfile
 * with no assignment behind it, and undoing it would move the furniture on somebody's behalf.
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

  /* Withdrawing a move must not write a location, since nobody carried the book anywhere. */
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
