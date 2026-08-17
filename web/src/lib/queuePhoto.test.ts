/**
 * Where a queued book's pictures are, and what a caller with room for one
 * falls back to.
 *
 * **The stored choice is gone and so are its four cases** (#363). There were
 * two answers to "which photograph do you want to see", kept in storage the way
 * the library's view is, and tests pinning that anything unrecognised fell back
 * rather than being trusted. The row draws the book now, which is the spine
 * standing against the front, so both photographs are on every row and there is
 * nothing left to choose or to remember. Nothing about crops or fallbacks went
 * with it: those are below, unchanged, because they are about where a picture
 * is rather than about which one somebody asked for.
 *
 * The fallback order matters more than it looks: half the queue is books whose
 * photographs are still being read, so the front is routinely not there yet,
 * and a queue of empty grey boxes is a queue nobody can work from.
 */

import { describe, expect, it } from 'vitest'
import { queuePictures, queueThumb } from './queuePhoto'
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

describe('queueThumb', () => {
  const all = capture({ front_image: 'f.jpg', edge_image: 'e.jpg', back_image: 'b.jpg' })

  /*
   * The change #135 was about. This used to prefer the spine, which is what a
   * book looks like once it is shelved and not what it looks like in the hands
   * of somebody working through a pile.
   */
  it('shows the front, which is how a book in your hands is recognised', () => {
    expect(queueThumb(all)).toBe('f.jpg')
  })

  it('falls back to the spine rather than drawing an empty box', () => {
    expect(queueThumb(capture({ edge_image: 'e.jpg' }))).toBe('e.jpg')
  })

  it('falls back to the back cover last, since it is only a barcode', () => {
    expect(queueThumb(capture({ back_image: 'b.jpg' }))).toBe('b.jpg')
  })

  it('says so plainly when a capture has no photograph at all', () => {
    expect(queueThumb(capture({}))).toBe('')
  })
})

/*
 * The rest of what the owner asked for: a book is shown, not the room it was
 * photographed in.
 *
 * Both halves are pinned here, and the second one is the one that will break if
 * somebody reaches for `front_crop` on its own. A crop is absent far more often
 * than it is present, because the detector declines most real photographs, and
 * `cropped` naming a slot with an empty crop column is a decline rather than a
 * missing file. Rendering that as a broken frame would take the queue from
 * "shows the room" to "shows nothing", which is worse.
 */
describe('the pictures of a book, once captures carry crops', () => {
  it('draws the cropped front where the detector found the book', () => {
    const cropped = capture({
      front_image: 'f.jpg', front_crop: 'f_crop.jpg', cropped: 'front',
    })
    expect(queuePictures(cropped).front).toBe('f_crop.jpg')
    expect(queueThumb(cropped)).toBe('f_crop.jpg')
  })

  it('draws the cropped spine the same way', () => {
    const cropped = capture({
      edge_image: 'e.jpg', edge_crop: 'e_crop.jpg', cropped: 'edge',
    })
    expect(queuePictures(cropped).spine).toBe('e_crop.jpg')
  })

  it('draws the whole photograph where the detector looked and declined', () => {
    const declined = capture({
      front_image: 'f.jpg', edge_image: 'e.jpg', cropped: 'front,edge',
    })
    expect(queuePictures(declined)).toEqual({ front: 'f.jpg', spine: 'e.jpg', back: '' })
  })

  it('draws the whole photograph where nothing has looked at it yet', () => {
    const unexamined = capture({ front_image: 'f.jpg', edge_image: 'e.jpg' })
    expect(queuePictures(unexamined)).toEqual({ front: 'f.jpg', spine: 'e.jpg', back: '' })
  })

  it('crops each slot on its own, so a decline is not filled in from another', () => {
    const half = capture({
      front_image: 'f.jpg', front_crop: 'f_crop.jpg',
      edge_image: 'e.jpg', cropped: 'front,edge',
    })
    expect(queuePictures(half)).toEqual({ front: 'f_crop.jpg', spine: 'e.jpg', back: '' })
  })

  /*
   * Which slot wins is settled before any crop is: a front photograph beats a
   * spine whether or not either cropped. Otherwise the one-picture caller would
   * quietly start drawing spines wherever the spine happened to crop and the
   * front did not.
   */
  it('does not let a crop on one slot change which slot is shown', () => {
    const spineOnlyCrop = capture({
      front_image: 'f.jpg', edge_image: 'e.jpg', edge_crop: 'e_crop.jpg',
      cropped: 'front,edge',
    })
    expect(queueThumb(spineOnlyCrop)).toBe('f.jpg')
  })

  it('crops the back too, on the rows that have nothing else to draw', () => {
    const backOnly = capture({
      back_image: 'b.jpg', back_crop: 'b_crop.jpg', cropped: 'back',
    })
    expect(queuePictures(backOnly).back).toBe('b_crop.jpg')
    expect(queueThumb(backOnly)).toBe('b_crop.jpg')
  })

  it('still falls back across slots once crops are in play', () => {
    const spineCroppedOnly = capture({ edge_image: 'e.jpg', edge_crop: 'e_crop.jpg' })
    expect(queueThumb(spineCroppedOnly)).toBe('e_crop.jpg')
  })
})

/**
 * A book drawn as a book needs the honest answer, not a substitute.
 *
 * This is the difference between the two functions above and the reason both
 * exist. `queueThumb` has room for one picture and a wrong photograph of the
 * right book beats a gap; `queuePictures` is read by a row drawing the spine
 * against the front, where standing the front in for a spine nobody has
 * photographed would draw one photograph twice and claim a spine exists.
 */
describe('the pictures of a book, one slot at a time', () => {
  it('leaves a slot empty rather than filling it from another', () => {
    expect(queuePictures(capture({ front_image: 'f.jpg' })))
      .toEqual({ front: 'f.jpg', spine: '', back: '' })
    expect(queuePictures(capture({ edge_image: 'e.jpg' })))
      .toEqual({ front: '', spine: 'e.jpg', back: '' })
  })

  it('answers three empty slots for a book nobody has photographed', () => {
    expect(queuePictures(capture({}))).toEqual({ front: '', spine: '', back: '' })
  })
})
