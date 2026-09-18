/**
 * What to believe when more than one catalogue answers about the same book.
 *
 * The part of `server/lookup.ts` with no network in it: given what we already
 * hold and what the extra catalogues said, it decides what may be taken, what
 * may not, and where each answer came from. Three rules, measured in
 * `docs/catalogue-sources.md`:
 *
 * 1. A supplement fills a gap and never overrides. Where the primary pair
 *    already stated a page count or a genre, the extra catalogues are not
 *    consulted about it, and `reconcile` returns nothing for that field even
 *    when it was handed one.
 * 2. Nothing is taken from a record until it is shown to be the same book. The
 *    record was retrieved by our ISBN, which is the first half; `sameBook`
 *    compares the catalogue's own title with ours, which is the second.
 * 3. Credits are out of scope, structurally. There is no author field on
 *    `SupplementaryRecord` and `reconcile` returns none.
 *
 * The records are handed to `reconcile` in rank order and the order is the rank:
 * this file does not know one catalogue's name from another's. So a disagreement
 * about the page count is settled by rank, and reported rather than dropped, in
 * `pagesDisagreedWith`.
 *
 * A disagreement about the genre is not settled here at all. The headings from
 * every verified source are merged, in rank order, and handed to `classify` in
 * `server/classify.ts`, which has a precedence ladder and answers `unknown` when
 * two confident signals contradict each other.
 */

/**
 * One extra catalogue's answer about one book, reduced to what may be taken.
 * There is deliberately no author, publisher, date or ISBN here: a shape that
 * cannot carry a credit is a stronger statement of rule 3 than a comment asking
 * the next person not to.
 */
export interface SupplementaryRecord {
  /** The catalogue, spelled as `lookup_source` spells it. */
  source: string
  /**
   * The record's own title proper, used to decide whether to believe the record
   * (`sameBook`) and for nothing else. The title on a book is never taken from
   * here: a record that disagrees about the title is a record to disbelieve
   * rather than a better spelling.
   */
  title: string
  /** The extent, as a number of pages, or null when the record states none. */
  pages: number | null
  /** Subject headings, as the catalogue spells them. */
  subjects: readonly string[]
  dewey: readonly string[]
  /** Library of Congress classifications. */
  lc: readonly string[]
}

/** What the primary catalogues already settled, which is what may not be touched. */
export interface HeldAlready {
  /** Our title, which is what a supplementary record is checked against. */
  title: string
  /** The page count we hold, empty when none. A non-empty value ends the matter. */
  pages: string
  /** Whether any primary source stated a genre. True ends the matter. */
  genreStated: boolean
}

/** What may be taken, and where each part of it came from. */
export interface Reconciliation {
  /** The page count to take, or empty when none may be. */
  pages: string
  /** The catalogue it came from, or empty. */
  pagesFrom: string
  /** Verified sources that stated a different number, in rank order. */
  pagesDisagreedWith: string[]
  /** Subject headings to classify with, merged in rank order. */
  subjects: string[]
  /** Dewey numbers, merged in rank order. */
  dewey: string[]
  /** LC classifications, merged in rank order. */
  lc: string[]
  /** The catalogues those headings came from, in rank order. */
  headingsFrom: string[]
  /** Sources whose record was confirmed to be this book. */
  verified: string[]
  /** Sources whose record was a different book, so nothing was taken from it. */
  rejected: string[]
}

export function nothingTaken(): Reconciliation {
  return {
    pages: '', pagesFrom: '', pagesDisagreedWith: [],
    subjects: [], dewey: [], lc: [],
    headingsFrom: [], verified: [], rejected: [],
  }
}

/**
 * The leading articles dropped before two titles are compared. Records disagree
 * about whether the article is part of the title proper far more often than they
 * disagree about the book, and MARC even carries a non-filing indicator saying
 * how many characters to skip. English, French, German and Spanish, which is
 * what the shelf actually holds.
 */
const ARTICLES = new Set([
  'the', 'a', 'an',
  'le', 'la', 'les', 'un', 'une',
  'der', 'die', 'das', 'ein', 'eine',
  'el', 'los', 'las', 'una',
])

/**
 * Letters that do not decompose under NFD and so survive the accent strip.
 * Handled by name because there are few of them and the alternative is a
 * transliteration table. Nothing here crosses a script: a Cyrillic title stays
 * Cyrillic and therefore never matches a Latin one, which is the correct answer.
 */
const LIGATURES: [RegExp, string][] = [
  [/ß/g, 'ss'], [/æ/g, 'ae'], [/œ/g, 'oe'],
  [/ø/g, 'o'], [/đ/g, 'd'], [/ð/g, 'd'], [/þ/g, 'th'], [/ł/g, 'l'],
]

/**
 * A title reduced to the part two catalogues could be expected to agree on:
 * case, accents, ISBD punctuation and a leading article all go. MARC 245 carries
 * its punctuation as data, so a title proper arrives as `Dune :` or
 * `The hobbit /`.
 */
export function normaliseTitle(raw: string): string {
  let value = (raw ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  for (const [pattern, replacement] of LIGATURES) value = value.replace(pattern, replacement)

  const words = value
    // Everything that is not a letter or a digit becomes a gap. This is what
    // takes the ISBD slash, colon and full stop out, and it takes apostrophes
    // and hyphens with them, so `l'etranger` and `l etranger` are one string.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (words.length > 1 && ARTICLES.has(words[0]!)) words.shift()
  return words.join(' ')
}

/**
 * Is the record in hand about the book in hand?
 *
 * Two titles agree when they normalise to the same string, or when one extends
 * the other at a word boundary and the shorter one is more than a single word.
 * The extension case covers a subtitle packed into the title proper.
 *
 * The single-word guard is the whole reason this is not `startsWith`: `Dune` and
 * `Dune Messiah` are two different books, and `It` is a prefix of a great many
 * things.
 *
 * An empty title on either side is a refusal rather than a match.
 */
export function sameBook(ours: string, theirs: string): boolean {
  const a = normaliseTitle(ours)
  const b = normaliseTitle(theirs)
  if (!a || !b) return false
  if (a === b) return true

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (!shorter.includes(' ')) return false
  return longer.startsWith(`${shorter} `)
}

/**
 * What may be taken from the extra catalogues, and from which of them.
 *
 * @param held what the primary catalogues already settled
 * @param records the extra catalogues' answers, in rank order
 */
export function reconcile(
  held: HeldAlready,
  records: readonly SupplementaryRecord[],
): Reconciliation {
  const result = nothingTaken()

  const verified: SupplementaryRecord[] = []
  for (const record of records) {
    if (sameBook(held.title, record.title)) {
      verified.push(record)
      result.verified.push(record.source)
    } else {
      result.rejected.push(record.source)
    }
  }

  // Rule 1, for the page count. A number we already hold is the answer, and the
  // offers below are not looked at.
  if (!held.pages) {
    const offers = verified.filter((record) => record.pages !== null)
    const chosen = offers[0]
    if (chosen) {
      result.pages = String(chosen.pages)
      result.pagesFrom = chosen.source
      result.pagesDisagreedWith = offers
        .slice(1)
        .filter((offer) => offer.pages !== chosen.pages)
        .map((offer) => offer.source)
    }
  }

  // Rule 1 again, for the genre. A genre any primary source stated is the
  // answer, and no heading from here is put in front of the classifier.
  if (!held.genreStated) {
    for (const record of verified) {
      const said = record.subjects.length || record.dewey.length || record.lc.length
      if (!said) continue
      result.subjects.push(...record.subjects)
      result.dewey.push(...record.dewey)
      result.lc.push(...record.lc)
      result.headingsFrom.push(record.source)
    }
  }

  return result
}
