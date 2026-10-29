import { describe, expect, it } from 'vitest'
import { groupByIsbn, othersThan, sameBookSaid, type QueueEntry } from './queueGroups'
import type { Capture } from './api'

const DUNE = '9780441172719'
const ROAD = '9780307387899'

function capture(id: number, over: Partial<Capture> = {}): Capture {
  return {
    id,
    status: 'ready',
    front_image: 'front.jpg',
    back_image: 'back.jpg',
    edge_image: 'edge.jpg',
    isbn13: '',
    isbn10: '',
    isbn_source: '',
    title_guess: '',
    cover_text: '',
    analysed: '',
    draft_json: '',
    edit_json: '',
    edited_by: '',
    edited_at: null,
    note: '',
    claimed_by: '',
    claimed_at: null,
    book_id: null,
    created_at: '',
    processed_at: null,
    front_crop: '',
    back_crop: '',
    edge_crop: '',
    cropped: '',
    ...over,
  }
}

/** Each entry as the ids it holds, which is what the list draws. */
const shape = (entries: QueueEntry[]) =>
  entries.map((entry) => (entry.kind === 'one' ? entry.capture.id : entry.captures.map((c) => c.id)))

describe('grouping the queue by ISBN', () => {
  it('gathers two scans of one book into one entry', () => {
    const entries = groupByIsbn([capture(1, { isbn13: DUNE }), capture(2, { isbn13: DUNE })])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'same', isbn13: DUNE })
    expect(shape(entries)).toEqual([[1, 2]])
  })

  it('puts the group where the first of its scans stands, and keeps everything else in order', () => {
    const entries = groupByIsbn([
      capture(5, { isbn13: ROAD }),
      capture(4, { isbn13: DUNE }),
      capture(3),
      capture(2, { isbn13: DUNE }),
      capture(1, { isbn13: ROAD }),
    ])
    expect(shape(entries)).toEqual([[5, 1], [4, 2], 3])
  })

  it('leaves a book scanned once on its own', () => {
    expect(shape(groupByIsbn([capture(1, { isbn13: DUNE }), capture(2, { isbn13: ROAD })])))
      .toEqual([1, 2])
  })

  it('never groups scans nobody could read an ISBN off, since no number is not a shared one', () => {
    expect(shape(groupByIsbn([capture(1), capture(2), capture(3, { isbn13: '  ' })])))
      .toEqual([1, 2, 3])
  })

  it('leaves a shelved scan out of the group: it is the book now, not a scan to choose between', () => {
    const entries = groupByIsbn([
      capture(1, { isbn13: DUNE, status: 'done' }),
      capture(2, { isbn13: DUNE }),
    ])
    expect(shape(entries)).toEqual([1, 2])
  })

  it('groups a scan still being read or stuck with the rest of its book', () => {
    const entries = groupByIsbn([
      capture(1, { isbn13: DUNE, status: 'pending' }),
      capture(2, { isbn13: DUNE, status: 'failed' }),
      capture(3, { isbn13: DUNE }),
    ])
    expect(shape(entries)).toEqual([[1, 2, 3]])
  })

  it('draws every capture exactly once', () => {
    const all = [
      capture(1, { isbn13: DUNE }), capture(2), capture(3, { isbn13: DUNE }),
      capture(4, { isbn13: ROAD }), capture(5, { isbn13: DUNE, status: 'done' }),
    ]
    const drawn = shape(groupByIsbn(all)).flat()
    expect([...drawn].sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('keeping one scan of a book', () => {
  it('discards every other scan in the group and never the one kept', () => {
    const group = [capture(1), capture(2), capture(3)]
    expect(othersThan(group[1]!, group).map((c) => c.id)).toEqual([1, 3])
  })

  it('says what keeping one does, counting the others', () => {
    expect(sameBookSaid(2)).toBe('2 scans of this book. Keep one and the other is discarded.')
    expect(sameBookSaid(3)).toBe('3 scans of this book. Keep one and the other 2 are discarded.')
  })
})
