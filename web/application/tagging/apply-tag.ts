/**
 * A person puts a book under a tag, or takes it back out.
 *
 * The two commands `docs/domain-model.md` gives the Corrector, and they are not
 * a restatement: somebody adding "lent out" is saying one thing, not saying
 * everything they have ever thought about a book. So these touch the tag they
 * name and nothing else, which is also why they need no transaction: one row,
 * one statement.
 *
 * ## What a person's removal removes
 *
 * Every source's row for that tag, not only the person's own. A person asking
 * for a tag to be gone is talking about the book, not about a row, and leaving
 * a catalogue's copy behind would answer them by showing the tag still there.
 *
 * The consequence, stated rather than discovered: re-running a catalogue lookup
 * that still claims that tag brings it back, because a retraction is not a
 * record of anything. Whether a person's removal should be remembered as a fact
 * that outlives the next lookup is open question 3 on #170, and it needs the
 * ledger that issue is about rather than a flag invented here.
 */

import { TagSlug, type TagConfidence } from '../../domain/tagging/tags'
import type { TagRepository } from './ports'

/** Somebody put this book under this tag. */
export interface ApplyTag {
  bookId: number
  /**
   * What the person typed. Normalised into a slug on the way in, so "Lent Out",
   * "lent out" and "LENT-OUT" are one tag rather than three near misses.
   */
  slug: TagSlug
  /** What anybody reads. Defaults to what they typed, which is the point of it. */
  label: string
  confidence?: TagConfidence
  now: string
}

export class ApplyTagHandler {
  constructor(private readonly tags: TagRepository) {}

  async handle(command: ApplyTag): Promise<void> {
    const tag = await this.tags.define(command.slug, command.label)
    await this.tags.apply(command.bookId, [{
      slug: tag.slug,
      source: 'person',
      // A person is not guessing. There is no scale on which somebody who has
      // the book in their hand is 'medium'.
      confidence: command.confidence ?? 'high',
      addedAt: command.now,
    }])
  }
}

/** Somebody took this book back out of this tag. */
export interface RemoveTag {
  bookId: number
  slug: TagSlug
}

export class RemoveTagHandler {
  constructor(private readonly tags: TagRepository) {}

  async handle(command: RemoveTag): Promise<void> {
    await this.tags.retract(command.bookId, [command.slug])
  }
}

/** Somebody renamed a tag. The slug does not move; see `TagRepository`. */
export interface RelabelTag {
  slug: TagSlug
  label: string
}

export class RelabelTagHandler {
  constructor(private readonly tags: TagRepository) {}

  async handle(command: RelabelTag): Promise<void> {
    await this.tags.relabel(command.slug, command.label)
  }
}

/** The slug a person's typing means, or null when it means nothing. */
export function slugFor(typed: string): TagSlug | null {
  return TagSlug.parse(typed)
}
