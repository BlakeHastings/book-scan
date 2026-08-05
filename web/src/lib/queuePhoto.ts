/**
 * Which photograph of a queued book the queue draws, and remembering that
 * somebody chose it.
 *
 * The same shape as `libraryView.ts`, deliberately: a closed set of answers to
 * one question, kept in localStorage rather than in App state because
 * `QueuePane` is unmounted the moment a capture is opened from it, and a
 * preference that resets every time you come back from a book is not a
 * preference. It also has to survive a reload, since the phone this runs on
 * drops the page whenever the camera app is used.
 *
 * Two answers rather than three because a capture only has two photographs
 * worth recognising a book by. The back cover is a barcode, not a face.
 */

import type { Capture } from './api'

export type QueuePhoto = 'front' | 'spine'

/**
 * In the order they are offered. Front first because that is what somebody
 * working through a stack is looking at: the books are face up in their hands,
 * not shelved end on (#120).
 */
export const QUEUE_PHOTOS: readonly QueuePhoto[] = ['front', 'spine']

/** A word each, because the switcher sits beside a search box. */
export const PHOTO_LABEL: Record<QueuePhoto, string> = {
  front: 'Front',
  spine: 'Spine',
}

/** Read out to somebody who cannot see which one is lit. */
export const PHOTO_DESCRIPTION: Record<QueuePhoto, string> = {
  front: 'Front: the cover, as the book is held',
  spine: 'Spine: the edge, as the book is shelved',
}

export const DEFAULT_PHOTO: QueuePhoto = 'front'

const KEY = 'bookscan.queuePhoto'

/**
 * Turn whatever was stored into a choice.
 *
 * Anything unrecognised falls back rather than throwing, for the same reason
 * `parseView` does: the stored value outlives the code that wrote it.
 */
export function parsePhoto(stored: string | null | undefined): QueuePhoto {
  return QUEUE_PHOTOS.includes(stored as QueuePhoto)
    ? (stored as QueuePhoto)
    : DEFAULT_PHOTO
}

/** The choice to open on. `DEFAULT_PHOTO` for somebody who has never chosen. */
export function rememberedPhoto(): QueuePhoto {
  try {
    return parsePhoto(localStorage.getItem(KEY))
  } catch {
    // Private browsing can refuse storage outright. A queue that will not
    // remember your choice is still a queue.
    return DEFAULT_PHOTO
  }
}

export function rememberPhoto(photo: QueuePhoto): void {
  try {
    localStorage.setItem(KEY, photo)
  } catch {
    // As above: worth doing, never worth failing over.
  }
}

/**
 * A slot's picture: the crop where the detector found the book, the whole
 * photograph where it did not.
 *
 * The fallback is the ordinary case, not the exception. On real photographs the
 * detector declines more often than it succeeds, and a decline is recorded as a
 * slot named in `cropped` with an empty crop column. Both of those read as an
 * empty string here and both mean the same thing to a thumbnail: draw the
 * photograph. An empty crop is never a missing picture, so it must never be
 * handed on as one.
 */
function pictureOf(crop: string, photo: string): string {
  return crop || photo
}

/**
 * The front photograph of a capture, cropped to the book where there is a crop.
 *
 * The one seam that knows what "the front" means. The owner asked for cropped
 * fronts so that somebody working through a stack sees the book rather than the
 * room around it (#135); #121 gave captures the crop columns, and this is where
 * every caller picks them up without knowing anything changed.
 */
function frontOf(capture: Capture): string {
  return pictureOf(capture.front_crop, capture.front_image)
}

/** The spine photograph of a capture, cropped the same way. */
function spineOf(capture: Capture): string {
  return pictureOf(capture.edge_crop, capture.edge_image)
}

/**
 * The back photograph, cropped the same way.
 *
 * Never asked for, only ever fallen back to, but cropped on the same terms as
 * the other two: a row drawing the back because nothing else exists yet should
 * not be the one row showing the table it was photographed on.
 */
function backOf(capture: Capture): string {
  return pictureOf(capture.back_crop, capture.back_image)
}

/**
 * The photograph to draw for a capture, given what was asked for.
 *
 * Falls through the other two rather than drawing an empty box: a capture is
 * photographed in whatever order somebody managed, and half of them are still
 * being read, so the asked-for shot is often simply not there yet. Showing the
 * wrong photograph of the right book beats showing nothing.
 *
 * Which slot wins is settled before any crop is considered, the way `bookCover`
 * settles it: a front photograph still beats a spine whether or not either
 * cropped. Only then does the crop of that slot stand in for the whole frame,
 * so a row showing the surrounding room is never showing it because a different
 * photograph happened to crop better.
 */
export function queueThumb(capture: Capture, photo: QueuePhoto): string {
  const front = frontOf(capture)
  const spine = spineOf(capture)
  const back = backOf(capture)
  const order = photo === 'front' ? [front, spine, back] : [spine, front, back]
  return order.find(Boolean) ?? ''
}
