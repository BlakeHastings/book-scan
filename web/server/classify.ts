/**
 * Fiction or non-fiction, from whatever the metadata sources gave us, and
 * nothing at all when they gave us nothing.
 *
 * Shelf 4 is the only non-fiction shelf, so a wrong answer sends the book to a
 * different bookcase entirely. Nothing here is allowed to be silent: the result
 * reaches the review pane as a toggle, and `source` records whether a human ever
 * looked at it.
 *
 * **The last rung answers no genre rather than fiction** (#304). Every rung
 * above it is grounded in something a catalogue actually said: a BISAC heading,
 * an Open Library subject, a Dewey number, an LC class. The last one is grounded
 * in nothing, and it used to answer `genre/fiction` with the confidence set to
 * `unknown` and a sentence asking the person to fix it. That is a guess wearing
 * an answer's clothes, and a save wrote it as a tag whether or not anybody read
 * the sentence. There is no scale of definiteness here and none was added: a
 * source either stated a genre or it did not, and `confidence` is where how
 * strongly it said so already lives.
 */

import {
  FICTION_SLUG, NON_FICTION_SLUG, type GenreSlug,
} from '../domain/tagging/catalogue-claims'

export type Confidence = 'high' | 'medium' | 'weak' | 'unknown'

export interface ClassificationInput {
  /** Google Books volumeInfo.categories, BISAC-derived and the best signal. */
  categories?: string[]
  /** Open Library subjects. */
  subjects?: string[]
  deweyDecimal?: string[]
  lcClassifications?: string[]
}

export interface Classification {
  /**
   * The genre this book is guessed to be under, as the tag it means (#227), or
   * null when no source stated one (#304).
   *
   * A slug rather than a boolean, because that is the vocabulary a genre
   * travels in now: the ladder below still reasons in fiction-or-not, which is
   * the only question it can answer, and this is where that becomes a claim
   * about a tag. `claimsFrom` turns it into the row the shelf range is derived
   * from, and writes no row at all when this is null.
   */
  genre: GenreSlug | null
  confidence: Confidence
  /** Human-readable justification, shown under the toggle. */
  reason: string
}

const NONFICTION_SUBJECTS = [
  'biography', 'autobiography', 'history', 'cookbook', 'cooking',
  'handbooks, manuals', 'self-help', 'reference', 'travel guide',
  'true crime', 'essays', 'memoir',
]

const FICTION_SUBJECTS = ['fiction', 'novel', 'novels', 'short stories']

function lower(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.toLowerCase().trim()).filter(Boolean)
}

/** A rung's fiction-or-not verdict, as the slug it claims. */
const asGenre = (isFiction: boolean): GenreSlug =>
  isFiction ? FICTION_SLUG : NON_FICTION_SLUG

/**
 * Precedence ladder, first match wins. If two high-confidence signals
 * disagree the result is downgraded to unknown so a human decides.
 */
export function classify(input: ClassificationInput): Classification {
  const categories = lower(input.categories)
  const subjects = lower(input.subjects)

  // 1. Google Books categories. BISAC headings start with the top-level
  //    subject, so "Fiction / Fantasy / Epic" and "Juvenile Fiction / ..."
  //    are unambiguous, as is "History" or "Biography & Autobiography".
  const primary = categories[0]
  let googleVerdict: boolean | null = null
  if (primary) {
    if (primary.startsWith('fiction') || primary.startsWith('juvenile fiction')) {
      googleVerdict = true
    } else if (primary.startsWith('juvenile nonfiction')) {
      googleVerdict = false
    } else {
      googleVerdict = false
    }
  }

  // 2 and 3. Open Library subjects.
  let olVerdict: boolean | null = null
  if (subjects.some((s) => FICTION_SUBJECTS.includes(s))) {
    olVerdict = true
  } else if (subjects.some((s) => NONFICTION_SUBJECTS.some((n) => s.includes(n)))) {
    olVerdict = false
  } else if (subjects.some((s) => s.includes('fiction'))) {
    // Catches "Science fiction", "Fiction, fantasy, epic" and friends, but
    // only after the explicit non-fiction check so "history of fiction" style
    // subjects do not flip a non-fiction book.
    olVerdict = true
  }

  if (googleVerdict !== null && olVerdict !== null && googleVerdict !== olVerdict) {
    return {
      genre: asGenre(googleVerdict),
      confidence: 'unknown',
      reason:
        `Sources disagree: Google says ${googleVerdict ? 'fiction' : 'non-fiction'}, ` +
        `Open Library says ${olVerdict ? 'fiction' : 'non-fiction'}. Please confirm.`,
    }
  }

  if (googleVerdict !== null) {
    return {
      genre: asGenre(googleVerdict),
      confidence: 'high',
      reason: `Google Books category "${categories[0]}"`,
    }
  }

  if (olVerdict !== null) {
    return {
      genre: asGenre(olVerdict),
      confidence: 'medium',
      reason: `Open Library subjects (${subjects.slice(0, 3).join(', ')})`,
    }
  }

  // 4. Dewey. The 8x3 literature-fiction classes (813 American, 823 English,
  //    833 German and so on) are fiction; 92/920/B is biography.
  const dewey = lower(input.deweyDecimal)
  for (const value of dewey) {
    const digits = value.replace(/[^0-9]/g, '')
    if (/^9?2\b/.test(value) || digits.startsWith('920')) {
      return { genre: NON_FICTION_SLUG, confidence: 'medium', reason: `Dewey ${value} (biography)` }
    }
    if (digits.length >= 3 && digits.startsWith('8') && digits[2] === '3') {
      return {
        genre: FICTION_SLUG, confidence: 'medium',
        reason: `Dewey ${value} (literature, fiction)`,
      }
    }
    if (digits.length >= 1) {
      return { genre: NON_FICTION_SLUG, confidence: 'medium', reason: `Dewey ${value}` }
    }
  }

  // 5. Library of Congress. PZ is juvenile fiction and is a real signal;
  //    bare PR/PS covers criticism too, so it stays unknown.
  const lc = lower(input.lcClassifications)
  if (lc.some((value) => value.startsWith('pz'))) {
    return { genre: FICTION_SLUG, confidence: 'weak', reason: 'LC class PZ (juvenile fiction)' }
  }

  // Nothing said anything. Not "probably fiction", not "non-fiction because it
  // is the other one": nobody knows, and that is the answer. The book then
  // carries no genre tag, no rule claims it, and it waits for a person instead
  // of being filed somewhere nobody chose.
  return {
    genre: null,
    confidence: 'unknown',
    reason: 'No catalogue says whether this is fiction. Please set it yourself.',
  }
}
