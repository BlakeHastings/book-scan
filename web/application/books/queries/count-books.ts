import type { CatalogueCounts, CatalogueReadModel } from '../ports'

/** How many books the catalogue holds, and how many of them are fiction, out, or on no plank. */
export class CountBooksHandler {
  constructor(private readonly catalogue: CatalogueReadModel) {}

  handle(): Promise<CatalogueCounts> {
    return this.catalogue.counts()
  }
}
