/**
 * Which photograph the queue draws, and what it falls back to.
 *
 * Two things are being pinned here. The stored choice outlives the code that
 * wrote it, exactly as the library's does, so anything unrecognised has to
 * fall back rather than be trusted. And the fallback order matters more than
 * it looks: half the queue is books whose photographs are still being read, so
 * the asked-for shot is routinely not there yet, and a queue of empty grey
 * boxes is a queue nobody can work from.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHOTO, parsePhoto, PHOTO_LABEL, QUEUE_PHOTOS, queueThumb,
} from './queuePhoto'
import type { Capture } from './api'

function capture(photos: Partial<Capture>): Capture {
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
    ...photos,
  }
}

describe('parsePhoto', () => {
  it('keeps a choice somebody actually made', () => {
    for (const photo of QUEUE_PHOTOS) expect(parsePhoto(photo)).toBe(photo)
  })

  it('opens on the front for somebody who has never chosen', () => {
    expect(parsePhoto(null)).toBe(DEFAULT_PHOTO)
    expect(parsePhoto(undefined)).toBe(DEFAULT_PHOTO)
    expect(DEFAULT_PHOTO).toBe('front')
  })

  it('falls back rather than trusting a value it does not recognise', () => {
    expect(parsePhoto('edge')).toBe(DEFAULT_PHOTO)
    expect(parsePhoto('')).toBe(DEFAULT_PHOTO)
    expect(parsePhoto('{"photo":"spine"}')).toBe(DEFAULT_PHOTO)
  })

  it('names both of them, since the switcher has a word of room', () => {
    for (const photo of QUEUE_PHOTOS) expect(PHOTO_LABEL[photo]).toBeTruthy()
  })
})

describe('queueThumb', () => {
  const all = capture({ front_image: 'f.jpg', edge_image: 'e.jpg', back_image: 'b.jpg' })

  /*
   * The change the issue is actually about. The row used to prefer the spine,
   * which is what a book looks like once it is shelved and not what it looks
   * like in the hands of somebody working through a pile.
   */
  it('shows the front when the front is what was asked for', () => {
    expect(queueThumb(all, 'front')).toBe('f.jpg')
  })

  it('shows the spine when the spine is what was asked for', () => {
    expect(queueThumb(all, 'spine')).toBe('e.jpg')
  })

  it('falls back to the other photograph rather than drawing an empty box', () => {
    expect(queueThumb(capture({ edge_image: 'e.jpg' }), 'front')).toBe('e.jpg')
    expect(queueThumb(capture({ front_image: 'f.jpg' }), 'spine')).toBe('f.jpg')
  })

  it('falls back to the back cover last, since it is only a barcode', () => {
    expect(queueThumb(capture({ back_image: 'b.jpg' }), 'front')).toBe('b.jpg')
    expect(queueThumb(capture({ back_image: 'b.jpg' }), 'spine')).toBe('b.jpg')
  })

  it('says so plainly when a capture has no photograph at all', () => {
    expect(queueThumb(capture({}), 'front')).toBe('')
    expect(queueThumb(capture({}), 'spine')).toBe('')
  })
})
