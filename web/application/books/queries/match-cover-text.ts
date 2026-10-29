import { foldReading, tellsAnything } from '../../../shared/cover-words'
import type { CoverTextMatch, CoverTextReadModel } from '../read-models'

export { foldReading, tellsAnything }

/**
 * How many nearest titles, and nearest names, are scored. Ten lost nothing on
 * the 160 real covers in `docs/the-cover-matcher.md`; this leaves room for a
 * collection a hundred times that size, where more titles crowd a reading.
 */
const CANDIDATES = 50

/**
 * One number to rank by: the mean of how alike the title is to the reading
 * and how alike the author's name is. Separate halves, so a cover showing
 * only a name still ranks that author's books above everyone else's, and a
 * book whose title and author are both there beats one sharing only the
 * title's words. `similarity` rather than `word_similarity`, measured: it
 * also counts what of the reading a title does not explain, so a short title
 * contained in a longer one ("Mars" in "The Gods of Mars") does not tie with
 * it. See `docs/the-cover-matcher.md`.
 */
export function coverTextScore(match: Pick<CoverTextMatch, 'titleSimilarity' | 'authorSimilarity'>): number {
  return (match.titleSimilarity + match.authorSimilarity) / 2
}

export interface MatchCoverText {
  /** Whatever OCR read off the front of a book, as it read it. */
  text: string
  /** How many candidates to answer, best first. */
  limit: number
}

export interface CoverTextCandidate extends CoverTextMatch {
  /** `coverTextScore`: 0 to 1, higher is more of the cover found in the book. */
  score: number
}

/**
 * The catalogued books whose title and author a cover photograph's text
 * names, best first. Takes the text rather than the photograph, so a reading
 * the ISBN path already made of the same photograph is reused rather than
 * OCR'd again. Answers nothing for a reading with no word in it worth finding
 * a book by.
 */
export class MatchCoverTextHandler {
  constructor(private readonly catalogue: CoverTextReadModel) {}

  async handle(query: MatchCoverText): Promise<CoverTextCandidate[]> {
    const text = foldReading(query.text)
    if (!tellsAnything(text)) return []
    const found = await this.catalogue.near(text, CANDIDATES)
    return found
      .map((match) => ({ ...match, score: coverTextScore(match) }))
      // By id on a tie, so one photograph always ranks the same way.
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, query.limit)
  }
}
