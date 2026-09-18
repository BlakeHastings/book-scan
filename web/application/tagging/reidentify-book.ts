/**
 * A row turned out to be a different book; what was on record about the old
 * one goes with it.
 *
 * Correcting an ISBN is the same person saying "this is a different book",
 * not an automated system overruling a person's answer: `BookTags.restatedBy`
 * still enforces that a guess may never retract a person's row, and this
 * command is not reachable from a lookup. The earlier answer is withdrawn
 * because it is no longer about this book, not because it was wrong.
 *
 * `ABOUT_THE_WORK` is the boundary: tags under these namespaces describe the
 * work (wrong about a different book), everything else describes this copy
 * (untouched by a reidentification).
 */

import { GENRE, SUBJECT } from '../../domain/tagging/catalogue-claims'
import { BookTags, type TagSlug } from '../../domain/tagging/tags'
import type { BookTransactions, TagRepository } from './ports'

/**
 * Prefixes: everything beneath one counts, so `subject/fiction/fantasy/epic`
 * is as much about the work as `subject` itself.
 */
export const ABOUT_THE_WORK: readonly TagSlug[] = [GENRE, SUBJECT]

/** Somebody has said this row is a different book from the one it was. */
export interface ReidentifyBook {
  bookId: number
}

export class ReidentifyBookHandler {
  constructor(
    private readonly tags: TagRepository,
    private readonly transactions: BookTransactions,
  ) {}

  async handle(command: ReidentifyBook): Promise<void> {
    const { bookId } = command

    await this.transactions.forBook(bookId, async () => {
      const carried = BookTags.of(await this.tags.of(bookId))

      // Deduplicated on the slug: two sources claiming one genre are two rows but one thing to retract.
      const stale = new Map<string, TagSlug>()
      for (const prefix of ABOUT_THE_WORK) {
        for (const tag of carried.at(prefix)) stale.set(tag.slug.value, tag.slug)
      }

      // No source given: every source's row goes, since these are claims about a book this row is no longer, not one source taking back its own.
      if (stale.size) await this.tags.retract(bookId, [...stale.values()])
    })
  }
}
