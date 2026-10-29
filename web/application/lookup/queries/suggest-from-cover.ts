import { offerFitsReading, readTitleAndAuthor, type ReadTitle } from '../../../shared/cover-reading'
import type { CatalogueRecord, CatalogueTitleSearch } from '../read-models'

export interface SuggestFromCover {
  /** The lines read off the front cover, best first. */
  lines: readonly string[]
}

/**
 * What a title search made of a cover, kept on the book as a suggestion.
 * `match` is never an identification: a person says whether it is the book.
 */
export interface TitleSuggestion {
  /** What was read off the cover and asked about. */
  read: ReadTitle
  /** The book the catalogue offered whose title the cover explains, or null. */
  match: CatalogueRecord | null
}

/**
 * Look a book up by the title and author read off its cover. Asks by title and
 * author first and by title alone if that finds nothing, and keeps an answer
 * only when the cover explains it (`offerFitsReading`).
 *
 * The match carries no ISBN. A title search answers a work, and the number it
 * lists is whichever edition Open Library put first, which is rarely the copy
 * in hand and never one this photograph showed.
 */
export class SuggestFromCoverHandler {
  constructor(private readonly catalogues: CatalogueTitleSearch) {}

  async handle(query: SuggestFromCover): Promise<TitleSuggestion | null> {
    const read = readTitleAndAuthor(query.lines)
    if (!read.title) return null

    const asks = read.author ? [read.author, ''] : ['']
    for (const author of asks) {
      const found = await this.catalogues.search(read.title, author)
      if (found.found && offerFitsReading(query.lines, read, found)) {
        return {
          read,
          match: {
            ...found,
            isbn13: '',
            isbn10: '',
            notes: [`Found by the title read off the cover, "${read.title}". Check it is the same book.`],
          },
        }
      }
    }
    return { read, match: null }
  }
}
