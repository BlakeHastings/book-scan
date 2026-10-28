/**
 * `TagReadModel` over the tag repository's own statements, the rolled-up
 * counts, and the rule conditions. Nothing here writes.
 */

import type { BookTagView, TagReadModel, TagView } from '../../application/tagging/read-models'
import type { TagSlug } from '../../domain/tagging/tags'
import type { Db } from '../../server/driver'
import { tagCounts } from '../books/tag-counts'
import { tagsRulesName } from '../shelving/areas'
import { DrizzleTagRepository } from './tag-repository'

export class DrizzleTagReadModel implements TagReadModel {
  private readonly tags: DrizzleTagRepository

  constructor(private readonly db: Db) {
    this.tags = new DrizzleTagRepository(db)
  }

  /**
   * The count rolls up, because choosing Fantasy shows the books tagged Urban
   * fantasy too, and a number that disagreed with the list one tap later would
   * be the screen contradicting itself.
   *
   * `ruled` is the truth about every tag rather than only the empty ones: a word
   * nothing carries that a rule asks for is somebody setting up a bookcase before
   * they own anything in it, and a flag whose meaning depended on the count
   * beside it would be read two ways.
   */
  async vocabulary(under?: TagSlug): Promise<TagView[]> {
    const [vocabulary, counted, ruled] = await Promise.all([
      this.tags.vocabulary(under),
      tagCounts(this.db),
      tagsRulesName(this.db),
    ])
    const counts = new Map(counted.map((one) => [one.slug, one.books]))
    return vocabulary.map((one) => ({
      slug: one.slug.value,
      label: one.label,
      note: one.note,
      books: counts.get(one.slug.value) ?? 0,
      ruled: ruled.has(one.slug.value),
    }))
  }

  /**
   * The label is looked up rather than carried on `AppliedTag`, because the
   * domain rule about who may retract what has no use for a display string.
   */
  async ofBook(bookId: number): Promise<BookTagView[]> {
    const [applied, vocabulary] = await Promise.all([
      this.tags.of(bookId), this.tags.vocabulary(),
    ])
    const labels = new Map(vocabulary.map((one) => [one.slug.value, one.label]))
    return applied.map((one) => ({
      slug: one.slug.value,
      label: labels.get(one.slug.value) ?? one.slug.value,
      source: one.source,
      confidence: one.confidence,
    }))
  }
}
