/**
 * Somebody cataloguing has a book in one hand and the phone in the other, and the only finger
 * free is the thumb of the hand holding it, so the shutter goes to that edge and the photographs
 * go to the other one.
 *
 * This stays in `localStorage` rather than on the server: the phone drops this page whenever the
 * camera app is used, and a preference that resets on a reload is not a preference.
 */

import type { Hand } from '../design/Camera'

/** Most people are right-handed, and a majority is a reason for a default rather than a reason to decide for somebody. */
export const DEFAULT_HAND: Hand = 'right'

const KEY = 'bookscan.hand'

/**
 * Turn whatever was stored into an answer.
 *
 * Anything unrecognised falls back rather than throwing, the same way
 * `parseView` does: the stored value outlives the code that wrote it.
 */
export function parseHand(stored: string | null | undefined): Hand {
  return stored === 'left' ? 'left' : DEFAULT_HAND
}

/** Which hand to draw for. `DEFAULT_HAND` for somebody who has never chosen. */
export function rememberedHand(): Hand {
  try {
    return parseHand(localStorage.getItem(KEY))
  } catch {
    // Private browsing can refuse storage outright, but that must not stop the camera from working.
    return DEFAULT_HAND
  }
}

export function rememberHand(hand: Hand): void {
  try {
    localStorage.setItem(KEY, hand)
  } catch {
    // As above: worth doing, never worth failing over.
  }
}

/** What choosing one means, said the way the settings screen says it. */
export const HAND_WORD: Record<Hand, string> = {
  left: 'Left',
  right: 'Right',
}
