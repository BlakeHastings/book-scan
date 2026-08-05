import { describe, expect, it } from 'vitest'
import { newestFirst } from './queueOrder'
import type { Capture, CaptureStatus } from './api'

function capture(id: number, status: CaptureStatus = 'ready'): Capture {
  return {
    id,
    status,
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
  }
}

describe('newestFirst', () => {
  it('puts the most recently scanned capture at the top', () => {
    const server = [capture(1), capture(2), capture(3)]
    expect(newestFirst(server).map((c) => c.id)).toEqual([3, 2, 1])
  })

  it('does not mutate the array the server returned', () => {
    const server = [capture(1), capture(2)]
    newestFirst(server)
    expect(server.map((c) => c.id)).toEqual([1, 2])
  })

  it('leaves a single capture or an empty queue alone', () => {
    expect(newestFirst([capture(5)]).map((c) => c.id)).toEqual([5])
    expect(newestFirst([])).toEqual([])
  })
})
