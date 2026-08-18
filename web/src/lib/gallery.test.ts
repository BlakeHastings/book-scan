/**
 * The arithmetic both of this app's photograph swipes round by.
 *
 * This file was the gallery's: which frames a book had, in which order, which
 * showed a crop and which the photograph it was cut from, and what shape a
 * spine turned out to be. `BookGallery` is gone (#387) and `Shots` in
 * `src/design/Shots.tsx` answers all of that now, drawn once for the wireframe
 * and the app together. What is left here is the one decision that was never
 * the component's: where a scroll has settled.
 */

import { describe, expect, it } from 'vitest'
import { frameAtScroll } from './gallery'

describe('frameAtScroll', () => {
  it('reports the frame a settled scroll is showing', () => {
    expect(frameAtScroll(0, 320, 3)).toBe(0)
    expect(frameAtScroll(320, 320, 3)).toBe(1)
    expect(frameAtScroll(640, 320, 3)).toBe(2)
  })

  it('rounds to the frame in view rather than the one just left', () => {
    // Snap points land a pixel or two off on a real device, and a dot that
    // says frame one while frame two fills the screen is worse than no dot.
    expect(frameAtScroll(318, 320, 3)).toBe(1)
    expect(frameAtScroll(322, 320, 3)).toBe(1)
  })

  it('never names a frame that does not exist', () => {
    // Rubber-band overscroll on iOS reports past the end, and briefly negative.
    expect(frameAtScroll(9999, 320, 3)).toBe(2)
    expect(frameAtScroll(-40, 320, 3)).toBe(0)
  })

  it('answers zero before the element has been laid out', () => {
    expect(frameAtScroll(0, 0, 3)).toBe(0)
  })
})
