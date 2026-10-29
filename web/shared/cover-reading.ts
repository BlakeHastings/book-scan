import { sameWord, tellingWords } from './cover-words'

/** A title and an author as read off a front cover, before anybody has checked them. */
export interface ReadTitle {
  title: string
  /** Empty when no line on the cover looked like a person's name. */
  author: string
}

/**
 * Words a cover carries that are never somebody's name, so a line holding one
 * is a tagline or an imprint rather than the author.
 */
const NOT_A_NAME = new Set([
  'novel', 'novels', 'book', 'books', 'edition', 'stories', 'story', 'tales', 'poems',
  'author', 'bestseller', 'bestselling', 'times', 'york', 'classics', 'classic',
  'introduction', 'translated', 'illustrated', 'volume', 'penguin', 'vintage', 'winner',
  'prize', 'award', 'series', 'complete', 'collected', 'selected', 'new',
])

/** "George Eliot", "URSULA K. LE GUIN", "J.R.R. Tolkien": two to five words, letters only, each one capitalised. */
function looksLikeAName(line: string): boolean {
  const words = line.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 5) return false
  return words.every((word) => /^[A-Z][A-Za-z.'-]*$/.test(word)
    && !NOT_A_NAME.has(word.toLowerCase().replace(/[^a-z]/g, '')))
}

/**
 * Which of the lines read off a cover is the title and which the author. The
 * lines arrive best first (`pickCoverLines`), and the first is the title,
 * which is what `title_guess` has always held; the author is the first other
 * line shaped like a name, or nothing.
 */
export function readTitleAndAuthor(lines: readonly string[]): ReadTitle {
  const [title = '', ...rest] = lines.map((line) => line.trim()).filter(Boolean)
  return { title, author: rest.find(looksLikeAName) ?? '' }
}

/**
 * How far a book a catalogue offered is the one whose cover was read, from
 * the reading's side and the book's at once, the way `titleExplains` asks it
 * of a catalogued book:
 *
 *  - every telling word of the offered title is read somewhere on the cover,
 *    within the given share, and
 *  - the title line read is that much made of the offered title's words.
 *
 * And, where an author was read, at least one word of the offered authors is
 * on the cover too. A search answers its nearest title whatever was asked, so
 * this is what stops "Dune" answering for a cover of "Dune Messiah", or a
 * namesake by somebody else answering for the book in hand.
 */
export function offerFitsReading(
  lines: readonly string[],
  read: ReadTitle,
  offered: { title: string; authors: readonly string[] },
  share = 0.75,
): boolean {
  const titled = tellingWords(offered.title)
  if (!titled.length) return false
  const everything = lines.flatMap((line) => tellingWords(line))
  const has = (words: readonly string[], word: string) => words.some((other) => sameWord(word, other))

  const titleRead = titled.filter((word) => has(everything, word)).length / titled.length
  const titleLine = tellingWords(read.title)
  const lineHeld = titleLine.length
    ? titleLine.filter((word) => has(titled, word)).length / titleLine.length
    : 0
  if (titleRead < share || lineHeld < share) return false

  if (!read.author) return true
  const named = offered.authors.flatMap((name) => tellingWords(name))
  return named.some((word) => has(everything, word))
}
