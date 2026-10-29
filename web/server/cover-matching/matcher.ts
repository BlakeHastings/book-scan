/**
 * The one shape every way of recognising a book from a photograph of its cover
 * is measured in, so that a hash, an embedding, cover text and any fusion of
 * them can sit in one table and be compared on the same photographs.
 *
 * `POST /api/books/scan` asks `MatchCoverHandler`
 * (`application/books/queries/match-cover.ts`), which earned its way there by
 * the fused rows in `scripts/cover-matchers.ts` (#669); `fused-matcher.ts`
 * scores that same handler here. Any other matcher earns its way the same way.
 */

/** One catalogued book, as a matcher is allowed to see it. */
export interface CatalogueBook {
  /** Opaque to the matcher; it is handed back unchanged on a candidate. */
  id: string
  title: string
  author: string
  /** The cover the catalogue holds for this book, as image bytes. */
  cover: Buffer
}

export interface Candidate {
  id: string
  /** Higher is more alike. Only comparable between candidates of one matcher. */
  score: number
}

export interface Answer {
  /** Best first. May be empty, and may be shorter than four. */
  candidates: Candidate[]
  /**
   * The one book this matcher would open without asking anybody, or null.
   * This is the bar the confident-wrong rate is measured against, so a matcher
   * declares it rather than the harness inventing one per matcher.
   */
  confident: string | null
}

export type CoverSearch = (photo: Buffer) => Promise<Answer>

export interface CoverMatcher {
  /** Short, for a table row. */
  readonly name: string
  /** The confident bar in words, printed under the table. */
  readonly bar: string
  /** Everything a matcher does once per catalogue: hashing, embedding, indexing. */
  prepare(catalogue: readonly CatalogueBook[]): Promise<CoverSearch>
}
