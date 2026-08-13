/**
 * Every book somebody owns, drawn three ways.
 *
 * Converted to the design system by #315. What it was is `ShelfView`, which is
 * still here and still the screen the arranging and carrying work reaches: this
 * one is the library as somebody browses it, and that one is the shelves as a
 * job of work. The two are being pulled apart deliberately rather than by
 * accident, and where each half lands is #313 and #314.
 */

import { LibraryPane } from '../components/LibraryPane'

export function LibraryScreen() {
  return <LibraryPane />
}
