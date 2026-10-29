/**
 * The words read off a cover photograph, as the cover matchers compare them
 * with a book's title and author. Pure functions over strings, so the text
 * handler and the fused matcher read a reading one way.
 */

/**
 * Words that say nothing about which book a cover is: on most covers, in most
 * titles, and what OCR reads most reliably of all.
 */
const UNTELLING = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'its', 'are', 'was', 'not', 'but',
])

/**
 * The shortest word that counts as evidence. OCR breaks large type and
 * artwork into single letters and fragments ("O", "Mir", "Qu"), and a reading
 * made of nothing else names no book, however many titles share its
 * trigrams.
 */
const SHORTEST_TELLING_WORD = 4

/** Lower case, no accents, letters and digits only: "MIÉVILLE," reads as "mieville". */
export function foldReading(read: string): string {
  return read
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Whether a folded reading holds any word worth finding a book by. */
export function tellsAnything(folded: string): boolean {
  return folded.split(' ').some((word) => word.length >= SHORTEST_TELLING_WORD && !UNTELLING.has(word))
}

/**
 * The words of a title or a reading that could tell one book from another.
 * Shorter than `tellsAnything`'s four letters on purpose: "It" and "Ubik" are
 * whole titles, and "It Chapter Two" differs from "It" by "two". Two letters
 * and up, without the words every title has.
 */
const GLUE = new Set([...UNTELLING, 'of', 'a', 'an', 'to', 'in', 'on', 'at', 'by', 'or'])

export function tellingWords(text: string): string[] {
  return foldReading(text).split(' ').filter((word) => word.length >= 2 && !GLUE.has(word))
}

function trigrams(word: string): Set<string> {
  const padded = `  ${word} `
  const found = new Set<string>()
  for (let i = 0; i < padded.length - 2; i += 1) found.add(padded.slice(i, i + 3))
  return found
}

/**
 * Whether OCR's word is the printed one: half their trigrams shared, the way
 * `pg_trgm` counts them, so "darknes5" is "darkness" and "messiah" is not "dune".
 */
export function sameWord(read: string, printed: string): boolean {
  const a = trigrams(read)
  const b = trigrams(printed)
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared += 1
  return shared / (a.size + b.size - shared) >= 0.5
}

/** One line of a reading, with the height of its box in pixels; 0 when unknown. */
export interface ReadingLine {
  text: string
  height: number
}

/**
 * A line counts as part of the title when its type is at least this large
 * against the line that holds most of the title: a title broken over two
 * lines is one size, a tagline or a quote is smaller.
 */
const TITLE_TYPE = 0.8

/**
 * How well a reading and a book's title explain each other, once the author's
 * name is set aside: the smaller of
 *
 *  - the share of the title's words that were read anywhere on the cover, and
 *  - the share of the words printed in the title's type that the title holds.
 *
 * The second is what tells "Dune" from "Dune Messiah": a reading of the
 * second holds all of the first, and `word_similarity` says so, but "messiah"
 * is printed in the title's type and "Dune" does not explain it. Lines in
 * smaller type, the taglines and quotes, are left out of it when Paddle's line
 * boxes are given; without them the whole reading is the title's type, which
 * asks more often and is the safe direction.
 */
export function titleExplains(
  reading: string,
  lines: readonly ReadingLine[] | undefined,
  title: string,
  author: string,
): number {
  const titled = tellingWords(title)
  if (!titled.length) return 0
  const authored = tellingWords(author)
  const unauthored = (text: string) =>
    tellingWords(text).filter((word) => !authored.some((name) => sameWord(word, name)))
  const inTitle = (word: string) => titled.some((printed) => sameWord(word, printed))

  const read = unauthored(reading)
  const titleRead = titled.filter((printed) => read.some((word) => sameWord(word, printed))).length / titled.length

  let region = read
  const measured = (lines ?? []).filter((line) => line.height > 0)
  if (measured.length) {
    const scored = measured.map((line) => ({ line, hits: unauthored(line.text).filter(inTitle).length }))
    const best = scored.reduce((a, b) => (b.hits > a.hits || (b.hits === a.hits && b.line.height > a.line.height) ? b : a))
    if (best.hits === 0) return 0
    region = measured
      .filter((line) => line.height >= best.line.height * TITLE_TYPE)
      .flatMap((line) => unauthored(line.text))
  }
  if (!region.length) return 0
  const regionTitled = region.filter(inTitle).length / region.length

  return Math.min(titleRead, regionTitled)
}
