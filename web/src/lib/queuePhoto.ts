/**
 * The photographs of a queued book, cropped to the book where there is a crop.
 *
 * ## There is no longer a choice to remember
 *
 * There was, and it was two answers to "which photograph do you want to see":
 * the front or the spine, kept in localStorage because `QueuePane` is unmounted
 * the moment a capture is opened from it. #363 drew the row as the book itself,
 * which is the spine standing against the front, so both photographs are on
 * every row and the question has no second answer left. The preference, the
 * words for its two answers and the switcher that set it all went with it; what
 * stayed is the part every caller was really asking for, which is where a
 * capture's pictures are.
 */

import type { Capture } from './api'
import { coverUrl } from '../components/PlacementCard'
import type { Shot } from '../design/Shots'

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
 * One picture of a capture, for a caller with room for one.
 *
 * Falls through the other two rather than drawing an empty box: a capture is
 * photographed in whatever order somebody managed, and half of them are still
 * being read, so the front is often simply not there yet. Showing the wrong
 * photograph of the right book beats showing nothing.
 *
 * Which slot wins is settled before any crop is considered, the way `bookCover`
 * settles it: a front photograph still beats a spine whether or not either
 * cropped. Only then does the crop of that slot stand in for the whole frame,
 * so a row showing the surrounding room is never showing it because a different
 * photograph happened to crop better.
 *
 * It took the wanted slot as an argument while the queue let somebody choose
 * one. Nothing chooses now (#363): the queue draws the book, and the one caller
 * left is the thumbnail beside a book somebody has already photographed once.
 */
export function queueThumb(capture: Capture): string {
  return [frontOf(capture), spineOf(capture), backOf(capture)].find(Boolean) ?? ''
}

/**
 * The three photographs of a capture, each cropped where there is a crop and
 * empty where there is no photograph.
 *
 * No falling through from one to another, deliberately, which is the whole
 * difference between this and `queueThumb`. That one answers "draw me a picture
 * of this book" and a substitute is better than a gap. This one answers "which
 * photographs does it have", and a caller drawing the book needs the honest
 * answer: a spine nobody has photographed is drawn as the empty shape of a
 * spine, which is a thing worth knowing and is `Shots`'s own rule.
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
 * A waiting book's photographs, arranged as the book they are photographs of.
 *
 * Two, and the spine is the sliver, which is what makes `Shots` draw them as
 * one object rather than as two pictures. The face falls back to the back cover
 * because a book photographed back-first is a real thing somebody has in a
 * pile, and drawing the wrong photograph of the right book beats drawing an
 * empty box; it says which kind it is when it does. A kind nobody has
 * photographed is drawn as the empty shape of itself, which is `Shots`'s own
 * rule and is a thing worth knowing.
 *
 * It lived in `QueuePane` while the queue was the only screen drawing a waiting
 * book. The camera draws one too, when it finds the book in somebody's hands is
 * already on the table (#146), and two arrangements of one book is the fault
 * `Shots.tsx`'s header is entirely about. So it lives beside the pictures it is
 * made of, and both screens call it.
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
