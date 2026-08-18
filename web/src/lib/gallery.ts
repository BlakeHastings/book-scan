/**
 * The two things every gallery of a book's photographs in this app has to
 * agree about.
 *
 * ## It used to be a gallery, and the component it was for is gone (#387)
 *
 * `BookGallery` drew a book's photographs one at a time with the spine beside
 * them, and most of this file was the decisions that arrangement needed: which
 * frames there were, in what order, which of them showed a crop and which the
 * whole photograph, and what shape a spine turned out to be once it had
 * loaded. All of that is now `Shots` in `src/design/Shots.tsx`, which is the
 * component the wireframe draws with, so the app and the drawing put a book's
 * pictures on a screen the same way rather than two ways.
 *
 * What could not move is what did not belong to a component in the first
 * place, and it is what is left here: a piece of arithmetic two swipes share,
 * and a sentence about honesty that outlived the box it was written in.
 */

/**
 * Which frame a horizontal scroll has landed on.
 *
 * Rounding rather than flooring, so a scroll stopped a pixel short of a snap
 * point still reports the frame the reader is looking at.
 *
 * Read by both swipes in `src/design/Shots.tsx`, which are scroll containers
 * with snap points and both have to say which photograph is showing, so this
 * is one answer with two callers rather than the same rounding written twice.
 */
export function frameAtScroll(scrollLeft: number, frameWidth: number, count: number): number {
  if (frameWidth <= 0 || count <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.round(scrollLeft / frameWidth)))
}

/**
 * Said only where the detector was shown a photograph and declined to cut it.
 *
 * A photograph that still has the room around it says why, rather than being
 * quietly worse than the one beside it. A crop that cut a cover in half would
 * be the expensive mistake here, so the detector refuses whenever it is unsure,
 * and this is what refusing looks like on the screen where somebody is deciding
 * whether the photographs came out.
 *
 * It is a sentence rather than a mark for the reason every other note in this
 * app is one: a legend somebody has to have been told is no use at a bookcase.
 */
export const NOT_PICKED_OUT = 'The book could not be picked out, so this is the whole photo'
