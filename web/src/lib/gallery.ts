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

/*
 * `NOT_PICKED_OUT` was here, and it is drawn nowhere now (#409).
 *
 * It read "The book could not be picked out, so this is the whole photo", and
 * it was written under every photograph the detector had been shown and
 * declined to cut, on the screen for a book the catalogue already holds. That
 * screen was its only caller, and the owner named it off:
 *
 * > On the edit-the-details-for-a-book screen we have text underneath the images
 * > coming from the OCR system. We shouldn't show those, they're very intrusive.
 *
 * **So a diagnostic has gone out of the interface, deliberately and not
 * quietly.** What it said is still true and is still knowable: a photograph
 * with no crop beside it is a photograph the detector would not cut, and
 * `books.cropped` names every slot it was shown. Nothing about the detector, the
 * crops or what is stored changed. If it is ever wanted again it belongs
 * somewhere less intrusive than under each picture, and that is the owner's
 * call to make rather than this issue's.
 *
 * `Shot.note` in `src/design/Shots.tsx` is untouched: it is the general way a
 * photograph carries a word, and it now has no caller here.
 */
