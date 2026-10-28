import { resolveIsbnPair } from '../../../shared/isbn'
import type { CatalogueReadModel } from '../../books/read-models'
import type { CatalogueLookup, CatalogueRecord } from '../read-models'

export interface LookupIsbn {
  isbn: string
}

/** The catalogued book a looked-up number already belongs to. */
export interface AlreadyCatalogued {
  id: number
  title: string
  location: string
}

/**
 * What the catalogues say about a number, and whether this collection already
 * has it. Writes nothing: cataloguing the book is a separate act.
 */
export class LookupIsbnHandler {
  constructor(
    private readonly catalogues: CatalogueLookup,
    private readonly catalogue: CatalogueReadModel,
  ) {}

  async handle(query: LookupIsbn): Promise<{ record: CatalogueRecord; duplicateOf: AlreadyCatalogued | null }> {
    const record = await this.catalogues.lookup(query.isbn)
    const existing = await this.catalogue.findByIsbn(record.isbn13 || resolveIsbnPair(query.isbn).isbn13)
    return {
      record,
      duplicateOf: existing
        ? { id: existing.id, title: existing.title, location: existing.location }
        : null,
    }
  }
}
