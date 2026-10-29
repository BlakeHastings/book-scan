import { describe, expect, it } from 'vitest'
import { lastBookLine, lastBookSettled, looksLike } from './lastBook'
import type { Capture } from './api'

function capture(fields: Partial<Capture>): Capture {
  return {
    id: 1,
    status: 'ready',
    front_image: '',
    back_image: '',
    edge_image: '',
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
    ...fields,
  }
}

const SEARCHED = JSON.stringify({
  read: { title: 'DUNE', author: 'Frank Herbert' },
  match: { found: true, title: 'Dune', authors: ['Frank Herbert'] },
})

describe('lastBookLine', () => {
  it('says the book was found, by the title the catalogue answered', () => {
    const read = capture({ draft_json: JSON.stringify({ found: true, title: 'Dune' }) })
    expect(lastBookLine(read)).toBe('Last book: Dune, found')
  })

  it('says it is still reading while the queue has not finished', () => {
    expect(lastBookLine(capture({ status: 'pending' }))).toBe('Last book: still reading')
  })

  it('says it is still sending when no photograph has reached the server yet', () => {
    expect(lastBookLine(null)).toBe('Last book: still sending')
  })

  it('asks rather than tells when only the cover title was searched', () => {
    expect(lastBookLine(capture({ status: 'failed', title_search_json: SEARCHED })))
      .toBe('Last book: looks like Dune?')
  })

  it('says plainly where a book with nothing read has gone', () => {
    expect(lastBookLine(capture({ status: 'failed' })))
      .toBe('Last book: no ISBN read, it is in the queue')
  })
})

describe('lastBookSettled', () => {
  it('keeps asking until the reading is over', () => {
    expect(lastBookSettled(null)).toBe(false)
    expect(lastBookSettled(capture({ status: 'pending' }))).toBe(false)
    expect(lastBookSettled(capture({ status: 'ready' }))).toBe(true)
    expect(lastBookSettled(capture({ status: 'failed' }))).toBe(true)
  })
})

describe('looksLike', () => {
  it('prefers the title the catalogue answered over the one read off the cover', () => {
    expect(looksLike({
      read: { title: 'DUNE', author: '' },
      match: { found: true, title: 'Dune' } as never,
    })).toBe('Looks like Dune?')
  })

  it('falls back to the title read off the cover', () => {
    expect(looksLike({ read: { title: 'Dune Messiah', author: '' }, match: null }))
      .toBe('Looks like Dune Messiah?')
  })

  it('says nothing without a search', () => {
    expect(looksLike(null)).toBe('')
  })
})
