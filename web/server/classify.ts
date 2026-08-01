/**
 * Fiction or non-fiction, from whatever the metadata sources gave us.
 *
 * Shelf 4 is the only non-fiction shelf, so a wrong answer sends the book to a
 * different bookcase entirely. Nothing here is allowed to be silent: the
 * result always reaches the review pane as a toggle with the guess
 * pre-selected, and `source` records whether a human ever looked at it.
 */

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
  isFiction: boolean
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
      isFiction: googleVerdict,
      confidence: 'unknown',
      reason:
        `Sources disagree: Google says ${googleVerdict ? 'fiction' : 'non-fiction'}, ` +
        `Open Library says ${olVerdict ? 'fiction' : 'non-fiction'}. Please confirm.`,
    }
  }

  if (googleVerdict !== null) {
    return {
      isFiction: googleVerdict,
      confidence: 'high',
      reason: `Google Books category "${categories[0]}"`,
    }
  }

  if (olVerdict !== null) {
    return {
      isFiction: olVerdict,
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
      return { isFiction: false, confidence: 'medium', reason: `Dewey ${value} (biography)` }
    }
    if (digits.length >= 3 && digits.startsWith('8') && digits[2] === '3') {
      return { isFiction: true, confidence: 'medium', reason: `Dewey ${value} (literature, fiction)` }
    }
    if (digits.length >= 1) {
      return { isFiction: false, confidence: 'medium', reason: `Dewey ${value}` }
    }
  }

  // 5. Library of Congress. PZ is juvenile fiction and is a real signal;
  //    bare PR/PS covers criticism too, so it stays unknown.
  const lc = lower(input.lcClassifications)
  if (lc.some((value) => value.startsWith('pz'))) {
    return { isFiction: true, confidence: 'weak', reason: 'LC class PZ (juvenile fiction)' }
  }

  return {
    isFiction: true,
    confidence: 'unknown',
    reason: 'No classification signal found. Please set this yourself.',
  }
}
