/**
 * What looking a number up needs from the outside world: the national
 * catalogues, asked and never written to. A read model in the sense the
 * queries rule means, which is why it lives here rather than in a `ports.ts`.
 */

/** Which catalogue answered what, when more than one could have. */
export interface CatalogueProvenance {
  pages: string
  pagesDisagreedWith: string[]
  genre: string[]
  verified: string[]
  rejected: string[]
}

/**
 * What the catalogues say about one ISBN. `found` false is an answer, not a
 * failure: the book fields are then empty and `notes` says why.
 */
export interface CatalogueRecord {
  found: boolean
  title: string
  subtitle: string
  authors: string[]
  publisher: string
  published: string
  pages: string
  isbn13: string
  isbn10: string
  seriesName: string
  seriesIndex: number | null
  /** The catalogue's own image, on the catalogue's own host. */
  coverUrl: string
  /** Which catalogues answered, joined with ` + `. */
  source: string
  /** The genre tag the headings point at, or null when no source stated one. */
  classification: { genre: string | null; confidence: string; reason: string }
  notes: string[]
  subjects?: string[]
  categories?: string[]
  provenance?: CatalogueProvenance
}

/** The catalogues outside this app. The one implementation is `server/lookup.ts`. */
export interface CatalogueLookup {
  /** Answers `found: false` for a number nobody holds rather than throwing. */
  lookup(isbn: string): Promise<CatalogueRecord>
}
