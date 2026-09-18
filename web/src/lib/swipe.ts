/**
 * Deciding whether a finger on a queue row meant to discard the book.
 *
 * Discarding a capture deletes its photographs and the book is usually already
 * back in the pile, so an accidental swipe is data loss, not a rough edge. The
 * axis locks after the first `AXIS_SLOP` pixels of movement and never changes
 * for the rest of the gesture, the distance threshold requires the finger to
 * still be there when it lifts rather than reacting to a flick, and only
 * leftward travel arms a discard.
 */

/**
 * How far a finger travels before the gesture commits to an axis.
 *
 * Large enough that the ragged first few pixels of a vertical scroll, which
 * are never exactly vertical, do not read as sideways.
 */
export const AXIS_SLOP = 12

/** Roughly a quarter of a phone's width: far enough to not be scroll drift, short enough to be one thumb movement. */
export const DISCARD_DISTANCE = 96

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical'

export interface Swipe {
  readonly startX: number
  readonly startY: number
  /** Never below zero. */
  readonly dx: number
  readonly axis: SwipeAxis
}

export function beginSwipe(x: number, y: number): Swipe {
  return { startX: x, startY: y, dx: 0, axis: 'undecided' }
}

/** Once the axis is `vertical` this returns the swipe unchanged forever: no amount of further sideways travel turns a scroll into a discard. */
export function moveSwipe(swipe: Swipe, x: number, y: number): Swipe {
  if (swipe.axis === 'vertical') return swipe

  const dx = x - swipe.startX
  const dy = y - swipe.startY

  if (swipe.axis === 'undecided') {
    if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return swipe
    // Ties go to the scroll: a wrong scroll costs a second swipe, a wrong discard loses photographs.
    const axis: SwipeAxis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    if (axis === 'vertical') return { ...swipe, axis, dx: 0 }
    return { ...swipe, axis, dx: Math.max(0, -dx) }
  }

  return { ...swipe, dx: Math.max(0, -dx) }
}

/** Also what the row asks to decide whether to draw itself as armed. */
export function swipeArmed(swipe: Swipe): boolean {
  return swipe.axis === 'horizontal' && swipe.dx >= DISCARD_DISTANCE
}
