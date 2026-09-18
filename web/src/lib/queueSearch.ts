/**
 * A filter over the queue already in memory, not a search of the catalogue.
 *
 * It must never resort the newest-first order (`queueOrder.ts` says why that
 * order matters), and a capture's title and authors can be empty until a
 * lookup resolves, so matching has to cope with nothing to match against.
 */

import { draftFromCapture, type Capture } from './api'

/**
 * Letters Unicode's `NFD` normalisation will not decompose into a base letter plus a combining accent,
 * such as a letter with a stroke through it, so they need a manual fold.
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

/** Folds out case and accents, since a phone keyboard that autocorrects will rarely produce the diacritic. */
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
 * The title and authors, not the ISBN or queue number: those are how the machine
 * talks about a book, and somebody holding one reads the cover.
 *
 * The OCR guess is included because it is what the row is labelled with, so a
 * search that could not find a row by its own displayed name would be lying
 * about the list beside it.
 */
function haystack(capture: Capture): string {
  const draft = draftFromCapture(capture)
  return fold(
    `${draft.title} ${capture.title_guess} ${draft.subtitle} ${draft.authors}`,
  )
}

/**
 * Every word must appear somewhere, in any order, so "herbert dune" and "dune herbert" both match.
 * An empty query matches everything, which is what makes clearing the box restore the queue.
 */
export function matchesQuery(capture: Capture, query: string): boolean {
  const terms = fold(query).split(' ').filter(Boolean)
  if (terms.length === 0) return true
  const text = haystack(capture)
  return terms.every((term) => text.includes(term))
}

/** `filter` and nothing else, so the newest-first order survives a search untouched. */
export function filterQueue(captures: Capture[], query: string): Capture[] {
  if (!fold(query)) return captures
  return captures.filter((capture) => matchesQuery(capture, query))
}
