/**
 * One field and no mode switch: the reading is a pure function of the string. The line the
 * screen says out loud is drawn only where the answer is not obvious from what was typed, such
 * as a number that turned out to be an ISBN.
 */

import { normaliseIsbn } from '../../shared/isbn'

export type Find =
  /** An empty box. The screen shows the collection, which is most of its value. */
  | { kind: 'nothing' }
  /** Ten or thirteen digits, spaces and dashes ignored. At most one answer. */
  | { kind: 'isbn'; isbn: string }
  /** A `#`, and whatever has been typed after it so far. */
  | { kind: 'tag'; part: string }
  /** Anything else: titles and authors together, near enough rather than exact. */
  | { kind: 'words'; words: string }

/**
 * The order matters and is the order of how sure each reading is: `#` wins outright, then
 * digits at exactly the two lengths an ISBN has (nine digits means still typing one, so it
 * falls through to words rather than reporting no match), then everything else is words.
 */
export function readQuery(typed: string): Find {
  const trimmed = typed.trim()
  if (!trimmed) return { kind: 'nothing' }

  if (trimmed.startsWith('#')) return { kind: 'tag', part: trimmed.slice(1).trim() }

  // Only if there is nothing but digits, spaces and dashes: a rule that reached inside a string
  // for digits would take "1984" or "catch-22" as partial ISBNs.
  if (/^[0-9\s-]+$/.test(trimmed)) {
    const digits = normaliseIsbn(trimmed)
    if (digits.length === 10 || digits.length === 13) return { kind: 'isbn', isbn: digits }
  }

  return { kind: 'words', words: trimmed }
}

/** Nothing is the usual answer, deliberately: a screen that narrates every keystroke back is a screen somebody stops reading. */
export function saysWhat(found: Find): string {
  if (found.kind === 'isbn') {
    return found.isbn.length === 13
      ? 'Thirteen digits, so that is an ISBN.'
      : 'Ten digits, so that is an ISBN.'
  }
  if (found.kind === 'tag') return 'A #, so these are your tags.'
  return ''
}
