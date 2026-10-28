import type { TagSlug } from '../../../domain/tagging/tags'
import type { TagReadModel, TagView } from '../ports'

export interface Vocabulary {
  /** Only the tags at or under this one. */
  under?: TagSlug
}

/**
 * The vocabulary with a rolled-up count and whether a rule asks for each word.
 * Every word, not a page: there are tens of them where there are thousands of
 * books.
 */
export class VocabularyHandler {
  constructor(private readonly tags: TagReadModel) {}

  handle(query: Vocabulary): Promise<TagView[]> {
    return this.tags.vocabulary(query.under)
  }
}
