/**
 * Which shelf range a book files into, decided by the tags it carries.
 *
 * This is the inversion #223 makes. Until now `books.is_fiction` decided, a
 * column with room for exactly one question, and the genre tag was written
 * beside it from the same draft so the two could not disagree. From here the tag
 * decides and the column shadows it, which is what makes the column droppable
 * and what lets a second question about the same books be a second tag rather
 * than a second column.
 *
 * ## The two slugs, and the order they are tried in
 *
 * `genre/fiction` before `genre/non-fiction`, which is the order `0013` writes
 * its two placement rules in: fiction is rule 1 and non-fiction is rule 2, and
 * lower priority is tried first. So a book carrying both files as fiction here
 * and under the rules, and the two models keep answering the same thing. Those
 * books are the rows `0016` repairs; the ordering is what decides the ones
 * written after it, which is a case a person can still create by hand.
 *
 * **Every other `genre/*` slug is ignored rather than refused.** `genre/fantasy`
 * is a real tag somebody may apply, and it says nothing about which of the two
 * runs the book joins. A model that treated it as a third range would invent
 * furniture nobody has.
 *
 * ## A person's answer outranks a machine's, on the way out as well as in
 *
 * `BookTags.restatedBy` enforces the one-directional rule on the way in: a
 * lookup may take back its own tags and never a person's. That leaves a book
 * able to carry a person's `genre/fiction` and a catalogue's
 * `genre/non-fiction` at once, which `POST /api/books/:id/tags/refresh` creates
 * whenever a catalogue disagrees with somebody. Reading the pair back with no
 * regard for who said what would let a lookup move a book a person had filed,
 * which is the same loss the write rule exists to prevent, arriving from the
 * other side. So a person's genre tag is consulted first, and only when nobody
 * has said anything do the machines get a turn.
 *
 * That is a difference from `0013`'s rules, which know nothing of sources and
 * settle every tie on `priority`. It is deliberate and it is written down here
 * rather than discovered: the placement cut-over inherits the question, and the
 * answer it wants is a `source` condition on a rule, not this file being
 * weakened to match.
 */

import type { ShelfRange } from '../../shared/shelving'
import {
  FICTION, FICTION_SLUG, NON_FICTION, NON_FICTION_SLUG, type GenreSlug,
} from './catalogue-claims'
import type { AppliedTag, TagConfidence } from './tags'

export type { GenreSlug }

/**
 * The slug and the range that go together, in the order `0013` tries its rules.
 *
 * One table rather than two mappings facing each other. A slug that has a range
 * and a range that has a slug are the same fact, and holding it once is what
 * stops the answer to "which range" and the answer to "which tag" drifting
 * apart the way the column and the tag were always able to.
 */
export const GENRE_RANGES = [
  { slug: FICTION, range: 'fiction' },
  { slug: NON_FICTION, range: 'nonfiction' },
] as const satisfies readonly { slug: typeof FICTION; range: ShelfRange }[]

/**
 * What a save says about a book's genre.
 *
 * The boolean is gone. A save states the tag it means, so there is no
 * translation left to get wrong between what the client sends and what
 * `book_tag` ends up holding.
 *
 * **A save is allowed to state nothing** (#304). That is the state the rest of
 * this file could already describe and the write path could not reach: a book
 * no genre tag claims. It arrives here as `null` rather than as an absent key,
 * so a caller cannot forget to consider it.
 */
export interface StatedGenre {
  /** The slug this save states, or null when nothing has stated one. */
  genre: GenreSlug | null
  /** `manual` when somebody saved an edit. Anything else is the classifier. */
  classificationSource?: string
  classificationConfidence?: string
}

/**
 * The slug a request means, or null when it means neither of them.
 *
 * **Partial since #304, and the default it lost was protecting nobody.** It
 * answered `genre/non-fiction` to anything that was not the fiction slug,
 * because that is what `Boolean(body.isFiction)` gave a request carrying no
 * genre, and the point was that a caller sending the old boolean kept reading
 * the way it always had. There is no such caller: `books.is_fiction` was
 * dropped by #227, `isFiction` appears nowhere on the wire, in the client, or
 * in the browser suite, and `asDraft` is the only thing that calls this. What
 * the default did instead was file every book nobody classified into
 * non-fiction and report nothing.
 *
 * So the two slugs are read as themselves and everything else is null, which is
 * the same answer `rangeOfGenre` below has always given for a book no genre tag
 * claims. A person tapping either option still states one, and that is
 * unchanged and still wins.
 */
export function statedGenre(raw: unknown): GenreSlug | null {
  const value = String(raw ?? '')
  if (value === FICTION_SLUG) return FICTION_SLUG
  return value === NON_FICTION_SLUG ? NON_FICTION_SLUG : null
}

/**
 * The slug that goes with a range, or null when the range is not one of the two.
 *
 * The inverse of the table above, and the one direction a screen needs: a book
 * row carries the range its genre settled on, and the field beside the title
 * has to come up showing the tag that agrees with it.
 *
 * **It takes the column's own type, which is a string, rather than a
 * `ShelfRange`.** `books.shelf_range` holds `''` for a book that is in neither
 * run, which a queued book has always been and which a book no genre tag claims
 * is now, and reading that back as `genre/non-fiction` would put a tag in the
 * review pane that nothing had said.
 */
export function genreOfRange(range: string): GenreSlug | null {
  if (range === GENRE_RANGES[0].range) return FICTION_SLUG
  return range === GENRE_RANGES[1].range ? NON_FICTION_SLUG : null
}

/** The range a stated slug files into, and null when nothing states one. */
export function rangeOfSlug(genre: GenreSlug | null): ShelfRange | null {
  return GENRE_RANGES.find((one) => one.slug.value === genre)?.range ?? null
}

/**
 * The genre one save states: the tag it becomes, and the range it files into.
 *
 * Both, from one row of `GENRE_RANGES`, because they are one statement said
 * twice. A caller that could hold the range without the tag is a caller that
 * can write a `shelf_range` no tag agrees with, and that is exactly the drift
 * this change exists to end.
 *
 * The source is the provenance the draft already carries, mapped the way `0002`
 * mapped it when it turned the column into rows: `manual` is a person, anything
 * else is this app's inference, which is a guess. A person is not guessing, so
 * their confidence is `high` rather than whatever the classifier last said.
 *
 * **Both are null when the save states nothing** (#304), and they are null
 * together for the same reason they are answered together. A save that states
 * no genre writes no tag, so there is no tag for a range to agree with, and the
 * fallback to `GENRE_RANGES[1]` that used to stand in here is what filed a book
 * nobody had classified into non-fiction.
 */
export function genreStatedBy(
  stated: StatedGenre,
): { tag: AppliedTag | null; range: ShelfRange | null } {
  const said = GENRE_RANGES.find((one) => one.slug.value === stated.genre)
  if (!said) return { tag: null, range: null }

  const decidedByPerson = stated.classificationSource === 'manual'
  return {
    tag: {
      slug: said.slug,
      source: decidedByPerson ? 'person' : 'guess',
      confidence: decidedByPerson ? 'high' : asConfidence(stated.classificationConfidence),
    },
    range: said.range,
  }
}

/**
 * The range a book's genre tags put it in, or null when none of them says.
 *
 * **Null is a real answer**, the same one `claim` in `domain/placement/rules.ts`
 * gives: a book no genre tag claims is a book the model cannot file, and saying
 * so is how somebody finds out. Guessing non-fiction because it is the other one
 * would put a book on a shelf nobody chose and report nothing.
 *
 * **A save can reach it since #304**, which is the whole of that change. Until
 * then a save always stated a genre and therefore always wrote one of the two
 * tags, so the only way in was somebody taking a tag off a book afterwards; the
 * model could say "nobody knows" and the write path could not produce it. Now a
 * save that no source and no person gave a genre to writes no genre tag, and
 * this is what it answers about the book afterwards.
 *
 * `applySchema` counts these books on every start. One that already had a range
 * keeps it and does not move, because the column is written by a save and by
 * nothing else; one that never had one is in neither run.
 */
export function rangeOfGenre(carried: readonly AppliedTag[]): ShelfRange | null {
  const said = (tags: readonly AppliedTag[]): ShelfRange | null => {
    for (const { slug, range } of GENRE_RANGES) {
      if (tags.some((tag) => tag.slug.equals(slug))) return range
    }
    return null
  }

  return said(carried.filter((tag) => tag.source === 'person')) ?? said(carried)
}

/** The classifier's confidence, back from a string, defaulting to unknown. */
export function asConfidence(raw: string | undefined): TagConfidence {
  return raw === 'high' || raw === 'medium' || raw === 'weak' ? raw : 'unknown'
}
