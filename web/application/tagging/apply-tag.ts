/**
 * A person puts a book under a tag, or takes it back out. Touches only the
 * tag it names, so no transaction is needed.
 *
 * Removing a tag removes every source's row for it, not just the person's
 * own. This is not remembered as a fact: a later catalogue lookup that still
 * claims the tag will bring it back.
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
      // A person is not guessing: there is no scale on which having the book in hand is 'medium'.
      confidence: command.confidence ?? 'high',
      addedAt: command.now,
    }])
  }
}

/**
 * Somebody made a word, with no book in their hand. The same `define` as
 * `ApplyTag`, minus applying it to a book. Idempotent, because `define` is:
 * naming a word a rule already asks for finds the existing row rather than
 * making a second one.
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
 * Somebody unmade a word. Refused, not cascaded, in two cases: a book still
 * carries it (`TagRepository.remove` reports this), or a rule asks for it
 * (checked here rather than in the repository, since a rule is placement's
 * concern, not the vocabulary's).
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

    // The delete's `where` can't distinguish "no such row" from "a book carries it", so that's resolved with a second read afterward, only to word the answer.
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
