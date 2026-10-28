/**
 * The vocabulary's own commands: making, unmaking and renaming a word. Putting a
 * book under one is `commands/apply-tag.ts`, because that changes a book.
 */

import { TagSlug } from '../../domain/tagging/tags'
import type { Tag, TagRepository } from './ports'

/**
 * Somebody made a word, with no book in their hand. The same `define` as
 * `ApplyTag` makes, minus applying it to a book. Idempotent, because `define` is:
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
