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
import type { Tag, TagRepository } from './ports'

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

/**
 * Somebody made a word, with no book in their hand.
 *
 * The third door, and the only one where the tag is the whole point rather than
 * a thing said about a book (#452). #377 named a tag while cataloguing one and
 * #433 named one on a book already shelved; both of those are `ApplyTag`, which
 * defines the tag on the way past because a book is what they are about.
 *
 * **This is the same `define` and deliberately nothing else.** `ApplyTag` minus
 * its second statement, so a word made here and a word made with a book in hand
 * are the same row written the same way, and the only difference between the
 * three doors is whether anything is standing under the word afterwards.
 *
 * Idempotent, because `define` is: naming a word a rule already asks for finds
 * the row rather than making a second one, which is what stops a rule quietly
 * beginning to match something new.
 */
export interface DefineTag {
  slug: TagSlug
  label: string
}

export class DefineTagHandler {
  constructor(private readonly tags: TagRepository) {}

  async handle(command: DefineTag): Promise<Tag> {
    return this.tags.define(command.slug, command.label)
  }
}

/**
 * Somebody unmade a word, and the two things that stop them.
 *
 * A word nothing carries is either litter or a setup, and the difference is
 * whether a rule asks for it. #400 lets a rule name a tag nothing carries, so a
 * word with no books on it that a rule points at is the deliberate half of
 * exactly the thing #452 built the door for: somebody laying out a bookcase for
 * a subject before they own anything in it. Taking that away would retract
 * somebody's judgement, and nothing here retracts anybody's judgement.
 *
 * So both refusals, and they are refusals rather than cascades:
 *
 * - a book carries it, which `TagRepository.remove` answers by not removing it
 * - a rule asks for it, which is asked here because a rule is not this
 *   vocabulary's business and a tag repository reading `rule_condition` would
 *   be the tagging side knowing how placement stores a tag
 *
 * The answer says which, because "it could not be removed" sends somebody
 * hunting and "a rule asks for this one" is the whole explanation.
 */
export interface ForgetTag {
  slug: TagSlug
}

export type Forgetting =
  | { kind: 'gone' }
  /** A rule asks for it, so it is somebody's setup rather than litter. */
  | { kind: 'ruled' }
  /** Books carry it, so it is not an empty word at all. */
  | { kind: 'carried' }
  /** There was no such word to begin with. */
  | { kind: 'unknown' }

export class ForgetTagHandler {
  constructor(
    private readonly tags: TagRepository,
    /** Every slug a placement rule asks for. See `tagsRulesName`. */
    private readonly ruled: () => Promise<Set<string>>,
  ) {}

  async handle(command: ForgetTag): Promise<Forgetting> {
    if ((await this.ruled()).has(command.slug.value)) return { kind: 'ruled' }
    if (await this.tags.remove(command.slug)) return { kind: 'gone' }

    /*
     * It did not go, and the statement cannot say why: the same `where` covers
     * "no such row" and "a book carries it". Asked afterwards rather than
     * before, so the guard stays one statement and this is only about the words
     * somebody reads.
     */
    const still = await this.tags.vocabulary(command.slug)
    return still.some((one) => one.slug.equals(command.slug))
      ? { kind: 'carried' }
      : { kind: 'unknown' }
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
