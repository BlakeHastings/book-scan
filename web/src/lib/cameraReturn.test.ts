import { describe, expect, test } from 'vitest'
import { bookStillInHand } from './cameraReturn'

describe('bookStillInHand', () => {
  test('a plain capture that never left the camera stays in hand', () => {
    expect(bookStillInHand(false, null)).toBe(true)
  })

  test('a capture opened from the queue is not in hand, even unsaved', () => {
    // The #62 repro: open a capture from the queue, review it, and hit
    // "back to camera". The book was never picked up, so it must not
    // survive the trip and receive the next book's photo.
    expect(bookStillInHand(true, null)).toBe(false)
  })

  test('a catalogued book pulled up from the library is not in hand', () => {
    expect(bookStillInHand(false, 11)).toBe(false)
  })

  test('a catalogued book flagged as from the queue is still not in hand', () => {
    // Should not arise in practice (openBook always clears fromQueue), but
    // either signal being "not in hand" is enough to put the capture down.
    expect(bookStillInHand(true, 11)).toBe(false)
  })
})
