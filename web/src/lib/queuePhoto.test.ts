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
    front_crop: '',
    back_crop: '',
    edge_crop: '',
    cropped: '',
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

/*
 * The rest of what the owner asked for: the queue shows the book, not the room
 * it was photographed in.
 *
 * Both halves are pinned here, and the second one is the one that will break if
 * somebody reaches for `front_crop` on its own. A crop is absent far more often
 * than it is present, because the detector declines most real photographs, and
 * `cropped` naming a slot with an empty crop column is a decline rather than a
 * missing file. Rendering that as a broken frame would take the queue from
 * "shows the room" to "shows nothing", which is worse.
 */
describe('queueThumb, once captures carry crops', () => {
  it('draws the cropped front where the detector found the book', () => {
    const cropped = capture({
      front_image: 'f.jpg', front_crop: 'f_crop.jpg', cropped: 'front',
    })
    expect(queueThumb(cropped, 'front')).toBe('f_crop.jpg')
  })

  it('draws the cropped spine the same way', () => {
    const cropped = capture({
      edge_image: 'e.jpg', edge_crop: 'e_crop.jpg', cropped: 'edge',
    })
    expect(queueThumb(cropped, 'spine')).toBe('e_crop.jpg')
  })

  it('draws the whole photograph where the detector looked and declined', () => {
    const declined = capture({
      front_image: 'f.jpg', edge_image: 'e.jpg', cropped: 'front,edge',
    })
    expect(queueThumb(declined, 'front')).toBe('f.jpg')
    expect(queueThumb(declined, 'spine')).toBe('e.jpg')
  })

  it('draws the whole photograph where nothing has looked at it yet', () => {
    const unexamined = capture({ front_image: 'f.jpg', edge_image: 'e.jpg' })
    expect(queueThumb(unexamined, 'front')).toBe('f.jpg')
    expect(queueThumb(unexamined, 'spine')).toBe('e.jpg')
  })

  it('crops each slot on its own, so a decline is not filled in from another', () => {
    const half = capture({
      front_image: 'f.jpg', front_crop: 'f_crop.jpg',
      edge_image: 'e.jpg', cropped: 'front,edge',
    })
    expect(queueThumb(half, 'front')).toBe('f_crop.jpg')
    expect(queueThumb(half, 'spine')).toBe('e.jpg')
  })

  /*
   * Which slot wins is settled before any crop is: a front photograph beats a
   * spine whether or not either cropped. Otherwise a queue asked for fronts
   * would quietly start drawing spines wherever the spine happened to crop and
   * the front did not.
   */
  it('does not let a crop on one slot change which slot is shown', () => {
    const spineOnlyCrop = capture({
      front_image: 'f.jpg', edge_image: 'e.jpg', edge_crop: 'e_crop.jpg',
      cropped: 'front,edge',
    })
    expect(queueThumb(spineOnlyCrop, 'front')).toBe('f.jpg')
  })

  it('crops the back too, on the rows that have nothing else to draw', () => {
    const backOnly = capture({
      back_image: 'b.jpg', back_crop: 'b_crop.jpg', cropped: 'back',
    })
    expect(queueThumb(backOnly, 'front')).toBe('b_crop.jpg')
  })

  it('still falls back across slots once crops are in play', () => {
    const spineCroppedOnly = capture({ edge_image: 'e.jpg', edge_crop: 'e_crop.jpg' })
    expect(queueThumb(spineCroppedOnly, 'front')).toBe('e_crop.jpg')
  })
})
