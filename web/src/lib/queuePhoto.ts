/** The photographs of a queued book, cropped to the book where there is a crop. */

import type { Capture } from './api'
import { coverUrl } from '../components/PlacementCard'
import type { Shot } from '../design/Shots'

/**
 * A slot's picture: the crop where the detector found the book, the whole
 * photograph where it did not.
 *
 * The fallback is the ordinary case, not the exception: a decline is
 * recorded as an empty crop column, which reads the same as no crop at
 * all, and both must draw the photograph rather than a missing picture.
 */
function pictureOf(crop: string, photo: string): string {
  return crop || photo
}

/**
 * The front photograph of a capture, cropped to the book where there is a
 * crop. The one seam that knows what "the front" means.
 */
function frontOf(capture: Capture): string {
  return pictureOf(capture.front_crop, capture.front_image)
}

/** The spine photograph of a capture, cropped the same way. */
function spineOf(capture: Capture): string {
  return pictureOf(capture.edge_crop, capture.edge_image)
}

/**
 * The back photograph, cropped the same way: a row falling back to it
 * should not be the one row showing the table it was photographed on.
 */
function backOf(capture: Capture): string {
  return pictureOf(capture.back_crop, capture.back_image)
}

/**
 * One picture of a capture, for a caller with room for one.
 *
 * Falls through the other two rather than drawing an empty box, since half
 * a capture's photographs are often still missing. Which slot wins is
 * settled before any crop is considered, the same order `bookCover` uses:
 * a front photograph beats a spine whether or not either is cropped.
 */
export function queueThumb(capture: Capture): string {
  return [frontOf(capture), spineOf(capture), backOf(capture)].find(Boolean) ?? ''
}

/**
 * The three photographs of a capture, each cropped where there is a crop
 * and empty where there is no photograph. No falling through from one to
 * another, unlike `queueThumb`: a caller drawing the book needs the honest
 * answer of which photographs it has.
 */
export function queuePictures(capture: Capture): {
  front: string
  spine: string
  back: string
} {
  return {
    front: frontOf(capture),
    spine: spineOf(capture),
    back: backOf(capture),
  }
}

/**
 * A waiting book's photographs, arranged as the book they are photographs
 * of.
 *
 * The face falls back to the back cover, since a book photographed
 * back-first is real, and a kind nobody has photographed is drawn as the
 * empty shape of itself (`Shots`'s own rule).
 *
 * Shared by the queue and the camera, so both screens draw one book the
 * same way.
 */
export function shotsOf(capture: Capture): Shot[] {
  const pictures = queuePictures(capture)
  const face = pictures.front || pictures.back

  return [
    {
      word: 'Spine',
      sliver: true,
      photo: pictures.spine ? coverUrl(pictures.spine) : undefined,
    },
    {
      word: pictures.front ? 'Front' : 'Back',
      photo: face ? coverUrl(face) : undefined,
    },
  ]
}
