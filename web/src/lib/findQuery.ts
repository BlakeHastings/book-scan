/**
 * What somebody typed into the one box, and what the box made of it.
 *
 * The owner asked for one field and no mode switch:
 *
 * > We look and see whether they're putting in an ISBN. We look and see whether
 * > they're putting in the title or the author, and we fuzzy search by title and
 * > author. And we also look for tags. If the user wants to, they can put in
 * > like a pound sign and a tag, and we only show the books in that tag.
 *
 * So the reading is a pure function of the string, it lives here rather than in
 * the screen, and it is tested without a browser. Three kinds and an empty box,
 * which is the fourth and the one the whole screen is designed around.
 *
 * **The line the screen says out loud is here too.** It is drawn only where the
 * answer is not obvious from what was typed, which in practice is a number that
 * turned out to be an ISBN and a tag: nobody needs telling that "mieville" is
 * not thirteen digits. The alternative is four radio buttons above the field
 * that nobody would ever press.
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
 * Read the box.
 *
 * The order matters and it is the order of how sure each reading is. A `#` is a
 * character nobody types into a title by accident, so it wins outright. Digits
 * are next, and only at exactly the two lengths an ISBN has: nine digits is
 * somebody part way through typing one, and answering it with "no book has that
 * ISBN" while they are still typing is the silent failure this whole reading
 * exists to avoid. Everything else is words.
 */
export function readQuery(typed: string): Find {
  const trimmed = typed.trim()
  if (!trimmed) return { kind: 'nothing' }

  if (trimmed.startsWith('#')) return { kind: 'tag', part: trimmed.slice(1).trim() }

  // Only if there is nothing but digits, spaces and dashes in it. "1984" is a
  // title and "catch-22" is a title, and neither is four or eight digits long
  // anyway, but a rule that reached inside a string for digits would take them.
  if (/^[0-9\s-]+$/.test(trimmed)) {
    const digits = normaliseIsbn(trimmed)
    if (digits.length === 10 || digits.length === 13) return { kind: 'isbn', isbn: digits }
  }

  return { kind: 'words', words: trimmed }
}

/**
 * The quiet line under the field, or nothing.
 *
 * Nothing is the usual answer, deliberately: a screen that narrates every
 * keystroke back is a screen somebody stops reading. A person who types
 * thirteen digits and gets a fuzzy title match has been failed silently, and
 * that is the case this line is for.
 */
export function saysWhat(found: Find): string {
  if (found.kind === 'isbn') {
    return found.isbn.length === 13
      ? 'Thirteen digits, so that is an ISBN.'
      : 'Ten digits, so that is an ISBN.'
  }
  if (found.kind === 'tag') return 'A #, so these are your tags.'
  return ''
}
