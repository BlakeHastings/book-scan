import {
  PAGE_LIMIT, type CatalogueFilter, type CatalogueReadModel, type CataloguedBookView,
} from '../read-models'

/** A listing, narrowed and paged. An absent `limit` is the largest page, never every book. */
export interface ListBooks extends CatalogueFilter {
  limit?: number
  offset?: number
}

export class ListBooksHandler {
  constructor(private readonly catalogue: CatalogueReadModel) {}

  handle(query: ListBooks): Promise<{ books: CataloguedBookView[]; total: number }> {
    const { limit, offset, ...filter } = query
    return this.catalogue.list(filter, {
      limit: limit === undefined
        ? PAGE_LIMIT
        : Math.max(1, Math.min(PAGE_LIMIT, Math.floor(limit))),
      offset: offset ? Math.max(0, Math.floor(offset)) : 0,
    })
  }
}
