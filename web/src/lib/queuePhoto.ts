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
 * The front photograph of a capture.
 *
 * The one seam that knows what "the front" means. The owner asked for cropped
 * fronts, and captures have no crop columns and no derivatives today, so #121
 * carries that; when a cropped front lands it is added here and every caller
 * picks it up without knowing anything changed.
 */
function frontOf(capture: Capture): string {
  return capture.front_image
}

/** The spine photograph of a capture. */
function spineOf(capture: Capture): string {
  return capture.edge_image
}

/**
 * The photograph to draw for a capture, given what was asked for.
 *
 * Falls through the other two rather than drawing an empty box: a capture is
 * photographed in whatever order somebody managed, and half of them are still
 * being read, so the asked-for shot is often simply not there yet. Showing the
 * wrong photograph of the right book beats showing nothing.
 */
export function queueThumb(capture: Capture, photo: QueuePhoto): string {
  const front = frontOf(capture)
  const spine = spineOf(capture)
  const order = photo === 'front'
    ? [front, spine, capture.back_image]
    : [spine, front, capture.back_image]
  return order.find(Boolean) ?? ''
}
