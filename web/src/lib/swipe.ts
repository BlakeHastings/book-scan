/**
 * Deciding whether a finger on a queue row meant to discard the book.
 *
 * This is the gesture behind the one action on this page that destroys
 * something. Discarding a capture deletes its photographs, and the book it
 * photographed has usually been put back on the pile by then, so the only way
 * to get them back is to find the book again and re-photograph it. A gesture
 * that fires by accident is therefore not a rough edge here, it is data loss,
 * and the whole of this file exists to make accidental firing hard.
 *
 * Three rules, and each one rules out a way a thumb produces a swipe nobody
 * meant:
 *
 *   1. **One axis, decided once.** The queue is a vertical list on a phone, so
 *      most finger travel across a row is somebody scrolling. The first
 *      `AXIS_SLOP` pixels of movement decide which axis the gesture is on, and
 *      that decision is final for the rest of the gesture. A drag that started
 *      as a scroll can never become a discard, however far sideways it wanders
 *      afterwards.
 *   2. **Distance, not speed.** No velocity shortcut, no flick. The finger has
 *      to travel `DISCARD_DISTANCE` and still be there when it lifts. A flick
 *      is the easiest gesture to produce by accident and the hardest to
 *      produce on purpose while holding a book in the other hand.
 *   3. **One direction.** Left only. Rightward travel arms nothing.
 *
 * Pure and framework-free so the arithmetic can be tested without a browser,
 * which this project's test setup does not have.
 */

/**
 * How far a finger travels before the gesture commits to an axis.
 *
 * Small enough that a deliberate sideways drag is recognised immediately, and
 * large enough that the ragged first few pixels of a vertical scroll, which
 * are never exactly vertical, do not read as sideways.
 */
export const AXIS_SLOP = 12

/**
 * How far left the row goes before a lift discards.
 *
 * Roughly a quarter of a phone's width. Far enough that it cannot be reached
 * by the sideways drift of a scroll, short enough to be one comfortable thumb
 * movement.
 */
export const DISCARD_DISTANCE = 96

/** Which way a gesture turned out to be going. */
export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical'

export interface Swipe {
  /** Where the finger went down. */
  readonly startX: number
  readonly startY: number
  /** How far left the row has been dragged, never below zero. */
  readonly dx: number
  readonly axis: SwipeAxis
}

/** A finger has gone down on a row. Nothing is decided yet. */
export function beginSwipe(x: number, y: number): Swipe {
  return { startX: x, startY: y, dx: 0, axis: 'undecided' }
}

/**
 * The finger has moved. Work out where the row now sits.
 *
 * Once the axis is `vertical` this returns the swipe unchanged forever: the
 * list is being scrolled, and no amount of further sideways travel turns that
 * into a discard.
 */
export function moveSwipe(swipe: Swipe, x: number, y: number): Swipe {
  if (swipe.axis === 'vertical') return swipe

  const dx = x - swipe.startX
  const dy = y - swipe.startY

  if (swipe.axis === 'undecided') {
    // Nothing has travelled far enough to mean anything yet.
    if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return swipe
    // Ties go to the scroll. Somebody who meant to swipe will keep going and
    // the next gesture will be unambiguous; somebody who meant to scroll and
    // gets a discard has lost photographs.
    const axis: SwipeAxis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    if (axis === 'vertical') return { ...swipe, axis, dx: 0 }
    return { ...swipe, axis, dx: Math.max(0, -dx) }
  }

  return { ...swipe, dx: Math.max(0, -dx) }
}

/**
 * Is this swipe far enough that lifting the finger should discard?
 *
 * Also what the row asks to decide whether to draw itself as armed, so the
 * answer is visible under the thumb before the finger lifts, and letting go
 * early is how somebody backs out.
 */
export function swipeArmed(swipe: Swipe): boolean {
  return swipe.axis === 'horizontal' && swipe.dx >= DISCARD_DISTANCE
}
