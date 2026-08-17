/**
 * Which of a book's pictures a book's page opens on, and remembering that
 * somebody chose.
 *
 * ## Why there is a choice at all
 *
 * > On the book detail view, we should show the catalogue picture of the front
 * > of the book first if possible, instead of the one the user took. We should
 * > probably add that as a setting the user can set if they would like.
 *
 * Both halves of that are real. A downloaded cover is straight, lit, and the
 * same picture the rest of the world uses for that edition, which is what makes
 * it the better first look at a book. A photograph somebody took is of **this**
 * copy: the fifty-year-old paperback with the split spine, in the room it lives
 * in. Somebody cataloguing a shelf of book-club paperbacks wants the first;
 * somebody cataloguing their grandmother's books wants the second. Neither is
 * the wrong answer, so it is asked once and remembered.
 *
 * ## Why it is a setting rather than a control on the book page
 *
 * It is one answer about every book in the house, not an answer about the book
 * on the screen. A switch on a book's page would be asked again on the next
 * book, and #365 is a round of taking things off that page rather than adding a
 * fifth. `SettingsPane` is where it is asked, beside the two answers that were
 * already there, and #354's rule for that screen is met: there is something
 * honest behind it, and choosing changes what the next book you open looks
 * like.
 *
 * ## Why it is on the phone rather than on the collection
 *
 * The same reason `hand.ts` and `libraryView.ts` are. Everybody in the house
 * shares one collection and nobody signs in, so a preference written to the
 * server would be one person deciding for everybody. The settings screen says
 * exactly that in words, under all three: what you choose is remembered on this
 * phone and on no other.
 *
 * The `FirstPicture` type itself lives in `design/Shots.tsx`, with the
 * component that reads it, the way `Hand` lives in `design/Camera.tsx`. One
 * spelling of the key and one fallback, here, is what keeps the settings screen
 * and the book page from disagreeing about what was chosen.
 */

import type { FirstPicture } from '../design/Shots'

/**
 * What somebody who has never chosen gets, and it is the owner's answer:
 * "we should show the catalogue picture of the front of the book first if
 * possible."
 */
export const DEFAULT_FIRST_PICTURE: FirstPicture = 'catalogue'

const KEY = 'bookscan.firstPicture'

/**
 * Turn whatever was stored into an answer.
 *
 * Anything unrecognised falls back rather than throwing, the same way
 * `parseView` and `parseHand` do: the stored value outlives the code that
 * wrote it, and a book that opens on no picture at all is a worse outcome than
 * a book that opens on the default one.
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
 *
 * "Downloaded" is the word the book page already writes under that picture and
 * the word its dot is named by, so the setting and the thing it moves are
 * called the same thing. "Catalogue" is not: no screen in this app says it to
 * anybody.
 */
export const FIRST_PICTURE_WORD: Record<FirstPicture, string> = {
  catalogue: 'The downloaded one',
  yours: 'The one you took',
}
