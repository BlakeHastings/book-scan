/**
 * Which of a book's pictures a book's page opens on, and remembering that
 * somebody chose.
 *
 * A downloaded cover is straight, lit, and the same picture the rest of
 * the world uses for that edition. A photograph somebody took is of this
 * copy. Neither is the wrong answer, so it is asked once and remembered.
 *
 * On the phone rather than on the collection: everybody in the house
 * shares one collection and nobody signs in, so a preference written to
 * the server would be one person deciding for everybody.
 *
 * The `FirstPicture` type itself lives in `design/Shots.tsx`, with the
 * component that reads it. One spelling of the key and one fallback,
 * here, is what keeps the settings screen and the book page from
 * disagreeing about what was chosen.
 */

import type { FirstPicture } from '../design/Shots'

/** What somebody who has never chosen gets. */
export const DEFAULT_FIRST_PICTURE: FirstPicture = 'catalogue'

const KEY = 'bookscan.firstPicture'

/**
 * Turn whatever was stored into an answer. Anything unrecognised falls
 * back rather than throwing, since a stored value outlives the code that
 * wrote it.
 */
export function parseFirstPicture(stored: string | null | undefined): FirstPicture {
  return stored === 'yours' ? 'yours' : DEFAULT_FIRST_PICTURE
}

/** Which picture to open a book on. The default for somebody who has never chosen. */
export function rememberedFirstPicture(): FirstPicture {
  try {
    return parseFirstPicture(localStorage.getItem(KEY))
  } catch {
    // Private browsing can refuse storage outright. A page that will not
    // remember which picture you prefer still draws every picture.
    return DEFAULT_FIRST_PICTURE
  }
}

export function rememberFirstPicture(first: FirstPicture): void {
  try {
    localStorage.setItem(KEY, first)
  } catch {
    // As above: worth doing, never worth failing over.
  }
}

/**
 * What choosing one means, said the way the settings screen says it.
 * "Downloaded" matches the word the book page already writes under that
 * picture; "Catalogue" is not said to anybody elsewhere.
 */
export const FIRST_PICTURE_WORD: Record<FirstPicture, string> = {
  catalogue: 'The downloaded one',
  yours: 'The one you took',
}
