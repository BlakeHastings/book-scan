/**
 * Which hand somebody holds the phone in, and remembering that they said.
 *
 * ## Why it is a fact about a person rather than about a screen
 *
 * `design/Camera.tsx` makes the argument in full and it is worth the summary
 * here, because this file is what that argument turned into: somebody
 * cataloguing has a book in one hand and the phone in the other, the only
 * finger free is the thumb of the hand holding it, and a thumb sweeps an arc
 * from the bottom corner on its own side. So the shutter goes to that edge and
 * the photographs go to the other one. The default is the right, because most
 * people are right-handed, and a majority is a reason for a default rather
 * than a reason to decide for somebody.
 *
 * ## Why it moved out of the camera screen
 *
 * It was read and written inside `CaptureScreen.tsx`, which was the only
 * screen that could ask the question. The design system said where it really
 * belongs, in the header of `Camera.tsx`, before there was a screen to put it
 * on: *"In the app it belongs beside the rest of the settings and this is the
 * wireframe standing in for one."* #350 built that settings screen, so there
 * are two screens asking one question and the answer lives where they can both
 * reach it. A second spelling of the key or of the fallback is how the camera
 * and the settings screen end up disagreeing about which hand somebody chose.
 *
 * It stays in `localStorage` rather than on the server for the reason the
 * library's view does: the phone drops this page whenever the camera app is
 * used, and a preference that resets on a reload is not a preference. It is
 * also the honest place for it while everybody in the house shares one
 * collection, and the settings screen says exactly that in words.
 */

import type { Hand } from '../design/Camera'

/** The one somebody who has never chosen gets. See above for why it is this. */
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
    // Private browsing can refuse storage outright. A camera that will not
    // remember which hand you hold the phone in is still a camera.
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
