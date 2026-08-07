/**
 * A source states what it currently claims about a book, and the store is
 * brought into line with it.
 *
 * This is the command a catalogue lookup issues when it is re-run. The rule it
 * has to honour is the one in docs/data-model.md that the epic settled and told
 * nobody to relitigate:
 *
 * > A lookup may take back its own tags and no others. Re-running it deletes and
 * > rewrites rows where `source = 'catalogue'`, so a tag the catalogue stopped
 * > claiming goes away. It must never touch `source = 'person'`.
 *
 * **The enforcement is structural, in two places at once, and neither is a
 * check that could be forgotten.** `BookTags.restatedBy` only ever looks at the
 * rows carrying the restating source, so nothing else can appear in the removal
 * list it produces; and `TagRepository.retract` is given that source, so the
 * statement it runs is keyed on it as well. Either one alone would be correct.
 * Both, because the cost of being wrong is somebody's decision disappearing
 * silently, and a silent loss is the kind nobody reports.
 */

import { BookTags, type TagClaim, type TagSource } from '../../domain/tagging/tags'
import type { BookTransactions, TagRepository } from './ports'

/** What one source says about one book, right now. */
export interface RestateTags {
  bookId: number
  source: TagSource
  /**
   * Everything the source claims. **An empty list means it claims nothing**,
   * and retracts everything it previously said, which is the answer when a
   * catalogue has dropped a book's subject headings entirely. It is not a
   * no-op, and reading it as one is how a stale tag outlives the claim it came
   * from.
   */
  claims: readonly TagClaim[]
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
    const { bookId, source, claims, now } = command

    await this.transactions.forBook(bookId, async () => {
      // Read inside the transaction, and serialised on the book: two lookups
      // finishing at once would otherwise each compute a retraction from a
      // picture the other had already changed.
      const current = BookTags.of(await this.tags.of(bookId))
      const { retracted, applied } = current.restatedBy(source, claims)

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
 * A readable name for a slug nobody gave one for.
 *
 * The last segment, hyphens back to spaces, first letter up: `genre/juvenile-fiction`
 * reads as "Juvenile fiction". Deliberately dull, and deliberately not derived
 * from the string the catalogue sent, because the label is a display decision
 * and the first person to look at the vocabulary should be able to fix it
 * without anything else in the system moving.
 */
export function defaultLabel(slug: string): string {
  const last = slug.split('/').pop() ?? slug
  const words = last.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
