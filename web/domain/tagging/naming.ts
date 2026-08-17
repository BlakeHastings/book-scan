/**
 * Somebody naming a tag out loud, and the two things that must not happen when
 * they do.
 *
 * A rule claims a book by its tags, so a tag is how a book gets a place. This is
 * the rule behind the one box in the app where a person answers the question no
 * catalogue could: what is this, and therefore where does it live.
 *
 * ## The slug already folds spelling, and it is not enough
 *
 * `slugSegment` folds case, accents, punctuation and whitespace, so "Comic
 * Book", "comic book" and "COMIC-BOOK" are one slug before anything here runs.
 * What it does not fold is the plural: "comic books" is `comic-books`, and
 * `tag.slug` is byte-ordered under `COLLATE "C"`, so `comic-book` and
 * `comic-books` are two rows that sort apart, two tags in the list, two counts,
 * and two things a rule has to be written against to claim what one person
 * meant. Nothing anywhere reports that, because nothing is wrong: they are
 * simply two tags.
 *
 * So there is a second fold, `sameThing`, which is deliberately **not** the
 * identity. The slug stays exactly what it was, and this is only ever used to
 * ask "does your vocabulary already mean this?" before a new row is offered. A
 * fold used as an identity would be a second key that has to agree with the
 * first one forever; a fold used as a question can be made stricter later
 * without moving a single stored row.
 *
 * **And the answer to that question is a refusal, not a warning.** Where the
 * collection already means what was typed, the existing tag is offered and no
 * new one is. A screen that said "this looks similar, carry on?" is a screen
 * where the second comic book scanned makes the second comic book tag, which is
 * the whole thing this exists to stop.
 *
 * ## A genre is never written through here
 *
 * #304 was deliberate: this app states a genre only when a source did, and a
 * person choosing one is a different act that already wins. A free-text box that
 * happened to say "fiction" would be a third way to write the genre tag, arrived
 * at by typing rather than by deciding, and it would reach `books.shelf_range`
 * through `rangeOfGenre` without anybody having answered the question the two
 * options above the box are asking.
 *
 * So this answers `genre` for anything that means fiction or non-fiction, and
 * the screen sends the person to the two options rather than writing anything.
 * **Nothing named here is ever placed under `genre`**: a new tag goes under
 * `subject`, which is the namespace for what a book is *about*.
 *
 * ## Why `subject`, and why one destination rather than a choice
 *
 * Two reasons, and the first is this file's own subject matter. If a person's
 * word went somewhere of its own, "comic book" typed by a person and "Comic
 * book" sent by Google Books would be two tags meaning one thing, separated by
 * provenance instead of by spelling. Provenance is `book_tag.source` and it is
 * already recorded per row; the slug is shared vocabulary, and a person and a
 * catalogue describing the same book the same way must land on the same tag.
 *
 * The second is that a tag has to be somewhere a rule can reach. Rules match at
 * or below a slug, so a bare `comic-book` at the top of the vocabulary is under
 * nothing, and no rule anybody already has can claim it; `subject/comic-book`
 * is claimed by any rule asking for anything under subject the moment it is
 * written. Offering a choice of namespace would answer that better and cost a
 * form, and this is the screen somebody is standing at with a book in one hand.
 */

import { SUBJECT, FICTION, NON_FICTION } from './catalogue-claims'
import { TagSlug, slugSegment } from './tags'

/** A tag that exists, as little of one as this file needs. */
export interface KnownTag {
  readonly slug: string
  readonly label: string
}

/**
 * What a collection makes of a name somebody typed.
 *
 * Four answers and no fifth. Every one of them is a different thing for a screen
 * to draw, and the screen draws what it is handed rather than deciding any of
 * this for itself.
 */
export type Naming =
  /** Nothing in what was typed could be a tag at all: blank, or "???". */
  | { kind: 'nothing' }
  /** It means fiction or non-fiction, which the two options above the box answer. */
  | { kind: 'genre' }
  /**
   * The collection already means this. These are the tags that do.
   *
   * `nearly` is the case this whole file exists for: what was typed is not
   * spelled the way any of them is, and would have become a second tag meaning
   * the same thing. A screen says so out loud there, because being refused
   * without being told why reads as the box being broken.
   */
  | { kind: 'already'; tags: KnownTag[]; nearly: boolean }
  /** Nothing means it yet, so this is the tag it would become. */
  | { kind: 'new'; slug: string; label: string }

/**
 * One word, singular.
 *
 * Enough English to fold the plural somebody typed, and deliberately no more:
 * this decides whether two names are offered as one, and a clever rule that is
 * wrong in an unusual case is worse here than a dull one that is wrong in an
 * obvious one. "-ies" to "-y" after a consonant, "-es" after a sibilant, and a
 * bare "-s" that is not part of "ss".
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
 * **This is not an identity and must never become one.** `tag.slug` is the
 * identity, it is stored, it is what every placement rule references, and
 * nothing here produces a slug or changes one. What this produces is the answer
 * to a question asked once, at the moment somebody is about to make a tag.
 *
 * It takes one name rather than a path, because that is what a person types and
 * because two tags with the same name in different namespaces are still the
 * same word: `nameIn` is how a stored slug is reduced to one.
 */
export function sameThing(raw: string): string {
  const name = slugSegment(raw)
  if (!name) return ''
  return name.split('-').map(singular).join('')
}

/**
 * A tag's own name, without the namespace it sits in.
 *
 * The last part of the slug, which is the part a person would say out loud.
 * Exported because the question this file asks is asked across namespaces: a
 * collection that already keeps Comic book under one heading means it whatever
 * heading it is under.
 */
export function nameIn(slug: string): string {
  return slug.split('/').pop() ?? slug
}

/**
 * The label a new tag carries, from what was typed.
 *
 * The words as given, with the run of spaces closed up and the first letter
 * raised, and nothing else touched: "MTG" stays "MTG" rather than becoming
 * "Mtg". The label is what a person reads, so it is theirs; the slug is what
 * everything else references, and that is not.
 */
export function labelTyped(typed: string): string {
  const words = typed.trim().replace(/\s+/g, ' ')
  return words ? words[0]!.toUpperCase() + words.slice(1) : words
}

/**
 * Where a tag named from a screen is placed, and the one namespace it is.
 *
 * Exported so a screen can say where the new tag will go in the words the
 * collection already uses for it, rather than writing the word "subject" of its
 * own and drifting from this.
 */
export const NAMED_UNDER = SUBJECT

/** The two slugs this box may never write, as the fold sees them. */
const GENRE_KEYS = [FICTION, NON_FICTION].map((slug) => sameThing(nameIn(slug.value)))

/**
 * What a collection makes of a name somebody typed into the box.
 *
 * The order is the whole design. Genre first, because that is the one answer
 * that must never be reached by typing. Then what the collection already means,
 * because the second comic book somebody scans should find the tag rather than
 * make it again, and because that is where two spellings of one thing are
 * stopped. Only when nobody means it is a new one offered at all.
 *
 * A slash somebody typed is folded to a hyphen rather than read as nesting.
 * Deciding where a tag sits is not something a free-text box should be able to
 * do by accident, and `NAMED_UNDER` is the answer to where instead.
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
