/**
 * A row turned out to be a different book, and what was on record about the old
 * one goes with it.
 *
 * ## Why this is not a guess overruling a person
 *
 * The rule the tagging model exists for is one-directional: a person's answer
 * retracts a guess, and a guess must never retract a person's answer.
 * `docs/orchestrating.md` puts it as "automation may revise its own opinions,
 * never somebody else's judgement", and `BookTags.restatedBy` is where it is
 * enforced. Nothing here weakens it. A lookup restating its claims still cannot
 * reach a `person` row, and this command is not reachable from one.
 *
 * What happens here is different in kind. Correcting a book's ISBN is the same
 * person saying **this is a different book**. Their earlier answer was about the
 * book the row used to be, and it is not wrong about the new one so much as it
 * is not about it at all. So it is withdrawn rather than overruled, and the
 * trigger is the identity of the book changing rather than anything a save
 * claims about the genre.
 *
 * ## The decision, made once here rather than per tag kind
 *
 * A tag says one of two things: something about the work, or something about
 * this copy of it. `genre/non-fiction` is the first kind and so is every
 * `subject/*` heading a catalogue sent, and neither describes anything once the
 * row names a different book. `mine/lent-out` is the second: it is about the
 * object in the house, which correcting an ISBN does not touch, and throwing it
 * away would be the loss this whole model exists to prevent.
 *
 * `ABOUT_THE_WORK` is that boundary, and it is a list of namespaces rather than
 * a rule per tag kind so that #170's remaining tag kinds meet one decision
 * instead of repeating this one. A new namespace belongs in it if a tag under it
 * would be wrong about a different book, and nowhere near it if it would not.
 */

import { GENRE, SUBJECT } from '../../domain/tagging/catalogue-claims'
import { BookTags, type TagSlug } from '../../domain/tagging/tags'
import type { BookTransactions, TagRepository } from './ports'

/**
 * The namespaces that describe the work rather than the copy on the shelf.
 *
 * Prefixes, so everything beneath them is covered: `subject/fiction/fantasy/epic`
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

      // Deduplicated on the slug: two sources claiming one genre are two rows
      // and one thing to take off, and `retract` is asked for slugs.
      const stale = new Map<string, TagSlug>()
      for (const prefix of ABOUT_THE_WORK) {
        for (const tag of carried.at(prefix)) stale.set(tag.slug.value, tag.slug)
      }

      // No source given, so every source's row goes. That is the point: these
      // are not a lookup taking back its own claims, they are claims about a
      // book this row is no longer.
      if (stale.size) await this.tags.retract(bookId, [...stale.values()])
    })
  }
}
