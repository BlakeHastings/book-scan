/**
 * A source states what it currently claims about a book; the store is
 * brought into line with it. See docs/data-model.md: a lookup may retract
 * only its own tags, never `source = 'person'`.
 *
 * Enforced in two places: `BookTags.restatedBy` only considers rows from the
 * restating source, and `TagRepository.retract` is scoped to that source too.
 */

import { BookTags, type TagClaim, type TagSlug, type TagSource } from '../../domain/tagging/tags'
import type { BookTransactions, TagRepository } from './ports'

/** What one source says about one book, right now. */
export interface RestateTags {
  bookId: number
  source: TagSource
  /**
   * Everything the source claims. An empty list means it claims nothing now
   * and retracts everything it previously said; not a no-op.
   */
  claims: readonly TagClaim[]
  /**
   * The part of the vocabulary this source is speaking about; absent means
   * everything. A catalogue lookup re-reads the whole record, so absent is
   * correct there. A save states one question (e.g. genre) and passes that
   * namespace, so it does not retract tags the same source applied elsewhere.
   */
  within?: TagSlug
  /** Human readable names for the slugs, where the source supplied one. */
  labels?: ReadonlyMap<string, string>
  /** When this was said. Injected, so a timestamp in a test is not the clock's. */
  now: string
}

export class RestateTagsHandler {
  constructor(
    private readonly tags: TagRepository,
    private readonly transactions: BookTransactions,
  ) {}

  async handle(command: RestateTags): Promise<void> {
    const { bookId, source, claims, within, now } = command

    await this.transactions.forBook(bookId, async () => {
      // Read inside the transaction: two lookups finishing at once would otherwise each compute a retraction from a picture the other had already changed.
      const current = BookTags.of(await this.tags.of(bookId))
      const { retracted, applied } = current.restatedBy(source, claims, within)

      if (retracted.length) {
        await this.tags.retract(bookId, retracted.map((entry) => entry.slug), source)
      }

      for (const claim of applied) {
        const label = command.labels?.get(claim.slug.value) ?? defaultLabel(claim.slug.value)
        await this.tags.define(claim.slug, label)
      }

      if (applied.length) {
        await this.tags.apply(bookId, applied.map((claim) => ({
          slug: claim.slug,
          source,
          confidence: claim.confidence,
          addedAt: now,
        })))
      }
    })
  }
}

/**
 * A readable name for a slug nobody gave one for: the last segment, hyphens
 * to spaces, first letter capitalised. `genre/juvenile-fiction` reads as
 * "Juvenile fiction".
 */
export function defaultLabel(slug: string): string {
  const last = slug.split('/').pop() ?? slug
  const words = last.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
