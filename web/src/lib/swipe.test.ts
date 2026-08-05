/**
 * The gesture that destroys photographs.
 *
 * Everything asserted here is a way a thumb produces a swipe nobody meant. The
 * queue is a vertical list on a phone held in one hand while the other holds a
 * book, so the common accident is not a stray tap, it is a scroll that drifts
 * sideways. That case gets the most attention below because it is the one that
 * actually happens.
 */

import { describe, expect, it } from 'vitest'
import {
  AXIS_SLOP, beginSwipe, DISCARD_DISTANCE, moveSwipe, swipeArmed,
} from './swipe'

/** Run a finger through a series of points from where it went down. */
function drag(points: Array<[number, number]>) {
  let swipe = beginSwipe(200, 400)
  for (const [x, y] of points) swipe = moveSwipe(swipe, x, y)
  return swipe
}

describe('deciding which way a finger is going', () => {
  it('decides nothing at all until something has moved appreciably', () => {
    const swipe = drag([[200 - (AXIS_SLOP - 1), 400]])
    expect(swipe.axis).toBe('undecided')
    expect(swipeArmed(swipe)).toBe(false)
  })

  it('reads a sideways drag as sideways', () => {
    expect(drag([[200 - AXIS_SLOP - 5, 402]]).axis).toBe('horizontal')
  })

  it('reads a scroll as a scroll', () => {
    expect(drag([[198, 400 - AXIS_SLOP - 5]]).axis).toBe('vertical')
  })

  /*
   * The accident this whole gesture is arranged around. Somebody scrolls the
   * queue, their thumb arcs as it travels, and the drag ends up further
   * sideways than the discard distance. It must still be a scroll.
   */
  it('never lets a scroll become a discard, however far it later wanders', () => {
    const swipe = drag([
      [200, 340], // straight up: this is a scroll
      [180, 260],
      [200 - DISCARD_DISTANCE * 3, 120], // and now a long way sideways
    ])
    expect(swipe.axis).toBe('vertical')
    expect(swipe.dx).toBe(0)
    expect(swipeArmed(swipe)).toBe(false)
  })

  /*
   * A diagonal that is exactly balanced is far more likely to be a scroll than
   * a discard, and the costs are not symmetrical: a scroll read as a discard
   * loses photographs, a discard read as a scroll loses a second.
   */
  it('gives an exactly diagonal drag to the scroll', () => {
    expect(drag([[200 - 30, 400 - 30]]).axis).toBe('vertical')
  })
})

describe('deciding whether a sideways drag meant to discard', () => {
  it('does not arm until the row has travelled the whole distance', () => {
    expect(swipeArmed(drag([[200 - DISCARD_DISTANCE + 1, 400]]))).toBe(false)
    expect(swipeArmed(drag([[200 - DISCARD_DISTANCE, 400]]))).toBe(true)
  })

  /*
   * Distance and not speed, deliberately. A flick is the easiest gesture to
   * produce by accident and the hardest to produce deliberately with one hand,
   * so a fast short drag arms nothing: there is no velocity term to find.
   */
  it('is not shortened by a fast drag, because there is no such thing here', () => {
    // One enormous jump, which is what a flick looks like in events, but
    // stopping short. Nothing about how quickly it got there is consulted.
    expect(swipeArmed(drag([[200 - DISCARD_DISTANCE + 4, 400]]))).toBe(false)
  })

  it('arms on a leftward drag only', () => {
    const rightwards = drag([[200 + DISCARD_DISTANCE * 2, 400]])
    expect(rightwards.axis).toBe('horizontal')
    expect(rightwards.dx).toBe(0)
    expect(swipeArmed(rightwards)).toBe(false)
  })

  it('disarms again when the finger comes back, which is how you back out', () => {
    const swipe = drag([
      [200 - DISCARD_DISTANCE - 20, 400],
      [200 - 10, 400],
    ])
    expect(swipe.axis).toBe('horizontal')
    expect(swipeArmed(swipe)).toBe(false)
  })

  it('never reports the row dragged past its own right edge', () => {
    expect(drag([[200 - 40, 400], [260, 400]]).dx).toBe(0)
  })
})
