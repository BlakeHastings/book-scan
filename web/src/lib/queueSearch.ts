/**
 * Finding one book in the queue.
 *
 * Somebody stands with a stack and a question: is the one I am holding already
 * in here, and where did it get to. That is a filter over what has already
 * been fetched, not a search of the catalogue: the queue is small, it is
 * already in memory, and a round trip per keystroke would be slower than the
 * scrolling it replaces.
 *
 * Two rules it must not break:
 *
 *   - the order is the queue's, newest first, and a filter never resorts it
 *     (`queueOrder.ts` says why that order matters);
 *   - a capture is not a book. It has no catalogue id, and its title and
 *     authors are empty until a lookup resolves, so matching has to cope with
 *     there being nothing to match against.
 */

import { draftFromCapture, type Capture } from './api'

/**
 * Letters Unicode will not take apart.
 *
 * `NFD` splits an accent off the letter it sits under, which covers most of
 * what turns up on a spine. It does nothing for a letter with a stroke through
 * it, because there is no separate stroke character to split off, so
 * "Stanislaw" would otherwise never reach "Stanisław" from a keyboard that
 * cannot type one.
 */
const UNDECOMPOSABLE: Record<string, string> = {
  'ł': 'l',
  'ø': 'o',
  'đ': 'd',
  'ð': 'd',
  'þ': 'th',
  'ß': 'ss',
  'æ': 'ae',
  'œ': 'oe',
}

/**
 * Fold a string down to what somebody typing on a phone will produce.
 *
 * Case and accents both go: a keyboard that autocorrects everything it sees is
 * not going to produce "Stanisław", and a search that only finds a book when
 * the diacritic is right is a search that does not find the book.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\x00-\x7f]/g, (char) => UNDECOMPOSABLE[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Everything about a capture worth typing at it: its title and its authors.
 *
 * Not the ISBN, and not the number: those are how the machine talks about a
 * book, and somebody holding one reads the cover.
 *
 * The OCR guess is in here even though it reaches no field any more (#156).
 * Search has its own answer to whether a guess is good enough, and for
 * finding a book it plainly is: the guess is what the row is called, so a
 * search that could not find a row by the name it is drawn under would be a
 * search box that lies about the list beside it. Nothing is saved by typing.
 */
function haystack(capture: Capture): string {
  const draft = draftFromCapture(capture)
  return fold(
    `${draft.title} ${capture.title_guess} ${draft.subtitle} ${draft.authors}`,
  )
}

/**
 * Does this capture answer what was typed?
 *
 * Every word has to appear somewhere, in any order, so "herbert dune" finds
 * the book that "dune herbert" finds. Words rather than the raw string,
 * because "frank dune" is a reasonable thing to type and a substring match
 * would find nothing.
 *
 * An empty query matches everything, which is what makes clearing the box
 * restore the queue.
 */
export function matchesQuery(capture: Capture, query: string): boolean {
  const terms = fold(query).split(' ').filter(Boolean)
  if (terms.length === 0) return true
  const text = haystack(capture)
  return terms.every((term) => text.includes(term))
}

/**
 * The queue, narrowed to what was typed.
 *
 * `filter` and nothing else, on purpose: it preserves the order it was given,
 * so the newest-first arrangement survives a search untouched.
 */
export function filterQueue(captures: Capture[], query: string): Capture[] {
  if (!fold(query)) return captures
  return captures.filter((capture) => matchesQuery(capture, query))
}
