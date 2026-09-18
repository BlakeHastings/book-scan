/**
 * Somebody naming a tag out loud, and the two things that must not happen when
 * they do.
 *
 * `slugSegment` folds case, accents, punctuation and whitespace, so "Comic
 * Book", "comic book" and "COMIC-BOOK" are one slug before anything here runs.
 * What it does not fold is the plural: "comic books" is `comic-books`, and
 * `tag.slug` is byte-ordered under `COLLATE "C"`, so `comic-book` and
 * `comic-books` are two rows that sort apart and two things a rule has to be
 * written against to claim what one person meant.
 *
 * So there is a second fold, `sameThing`, which is deliberately not the
 * identity. The slug stays exactly what it was, and this is only ever used to
 * ask "does your vocabulary already mean this?" before a new row is offered.
 * Where the collection already means what was typed, the existing tag is offered
 * and no new one is: a refusal rather than a warning.
 *
 * A genre is never written through here. This app states a genre only when a
 * source did, or when a person chose one, so this answers `genre` for anything
 * that means fiction or non-fiction and the screen sends the person to the two
 * options above the box rather than writing anything. Nothing named here is ever
 * placed under `genre`: a new tag goes under `subject`.
 *
 * One destination rather than a choice, for two reasons. A person and a
 * catalogue describing the same book the same way must land on the same tag,
 * since provenance is `book_tag.source` and the slug is shared vocabulary. And
 * rules match at or below a slug, so a bare `comic-book` at the top of the
 * vocabulary is under nothing and no rule anybody already has can claim it.
 */

import { SUBJECT, FICTION, NON_FICTION } from './catalogue-claims'
import { TagSlug, slugSegment } from './tags'

export interface KnownTag {
  readonly slug: string
  readonly label: string
}

export type Naming =
  /** Nothing in what was typed could be a tag at all: blank, or "???". */
  | { kind: 'nothing' }
  /** It means fiction or non-fiction, which the two options above the box answer. */
  | { kind: 'genre' }
  /**
   * The collection already means this. These are the tags that do. `nearly` is
   * true when what was typed is not spelled the way any of them is, and would
   * have become a second tag meaning the same thing.
   */
  | { kind: 'already'; tags: KnownTag[]; nearly: boolean }
  /** Nothing means it yet, so this is the tag it would become. */
  | { kind: 'new'; slug: string; label: string }

/**
 * One word, singular. Enough English to fold the plural somebody typed and
 * deliberately no more: "-ies" to "-y" after a consonant, "-es" after a
 * sibilant, and a bare "-s" that is not part of "ss".
 */
function singular(word: string): string {
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`
  if (/(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (/[^s]s$/.test(word)) return word.slice(0, -1)
  return word
}

/**
 * The key two spellings of one idea share, or '' for a name that is not one.
 *
 * Everything `slugSegment` folds, plus the hyphen and the plural: "Comic Book",
 * "comic books" and "COMIC-BOOKS" all answer `comicbook`, and "Non-fiction",
 * "non fiction" and "Nonfiction" all answer `nonfiction`.
 *
 * This is not an identity and must never become one. `tag.slug` is the identity,
 * it is what every placement rule references, and nothing here produces a slug
 * or changes one.
 *
 * It takes one name rather than a path, because two tags with the same name in
 * different namespaces are still the same word: `nameIn` is how a stored slug is
 * reduced to one.
 */
export function sameThing(raw: string): string {
  const name = slugSegment(raw)
  if (!name) return ''
  return name.split('-').map(singular).join('')
}

/**
 * A tag's own name, without the namespace it sits in. Exported because the
 * question this file asks is asked across namespaces: a collection that already
 * keeps Comic book under one heading means it whatever heading it is under.
 */
export function nameIn(slug: string): string {
  return slug.split('/').pop() ?? slug
}

/**
 * The label a new tag carries: the words as given, with the run of spaces closed
 * up and the first letter raised, and nothing else touched, so "MTG" stays "MTG"
 * rather than becoming "Mtg".
 */
export function labelTyped(typed: string): string {
  const words = typed.trim().replace(/\s+/g, ' ')
  return words ? words[0]!.toUpperCase() + words.slice(1) : words
}

/**
 * Where a tag named from a screen is placed. Exported so a screen can say where
 * the new tag will go rather than writing the word "subject" of its own.
 */
export const NAMED_UNDER = SUBJECT

/** The two slugs this box may never write, as the fold sees them. */
const GENRE_KEYS = [FICTION, NON_FICTION].map((slug) => sameThing(nameIn(slug.value)))

/**
 * What a collection makes of a name somebody typed into the box.
 *
 * The order matters. Genre first, because that is the one answer that must never
 * be reached by typing; then what the collection already means, which is where
 * two spellings of one thing are stopped; only when nobody means it is a new one
 * offered at all.
 *
 * A slash somebody typed is folded to a hyphen rather than read as nesting, and
 * `NAMED_UNDER` is the answer to where a new tag sits instead.
 */
export function nameTag(typed: string, vocabulary: readonly KnownTag[]): Naming {
  const key = sameThing(typed)
  if (!key) return { kind: 'nothing' }
  if (GENRE_KEYS.includes(key)) return { kind: 'genre' }

  const name = slugSegment(typed)
  const already = vocabulary.filter((tag) => sameThing(nameIn(tag.slug)) === key)
  if (already.length) {
    return {
      kind: 'already',
      tags: [...already],
      nearly: !already.some((tag) => nameIn(tag.slug) === name),
    }
  }

  return {
    kind: 'new',
    slug: TagSlug.under(NAMED_UNDER.value, name).value,
    label: labelTyped(typed),
  }
}
