/**
 * Which shelf range a book files into, decided by the tags it carries.
 *
 * The tag decides and `books.shelf_range` shadows it, which is what lets a
 * second question about the same books be a second tag rather than a second
 * column.
 *
 * `genre/fiction` is tried before `genre/non-fiction`, which is the order `0013`
 * writes its two placement rules in, so a book carrying both files as fiction
 * here and under the rules.
 *
 * Every other `genre/*` slug is ignored rather than refused. `genre/fantasy` is
 * a real tag somebody may apply, and it says nothing about which of the two runs
 * the book joins.
 *
 * A person's genre tag is consulted first, and only when nobody has said
 * anything do the machines get a turn. A book can carry a person's
 * `genre/fiction` and a catalogue's `genre/non-fiction` at once, and reading the
 * pair back with no regard for who said what would let a lookup move a book a
 * person had filed. That is a difference from `0013`'s rules, which know nothing
 * of sources and settle every tie on `priority`.
 */

import type { ShelfRange } from '../../shared/shelving'
import {
  FICTION, FICTION_SLUG, NON_FICTION, NON_FICTION_SLUG, type GenreSlug,
} from './catalogue-claims'
import type { AppliedTag, TagConfidence } from './tags'

export type { GenreSlug }

/**
 * The slug and the range that go together, in the order `0013` tries its rules.
 * One table rather than two mappings facing each other: a slug that has a range
 * and a range that has a slug are the same fact.
 */
export const GENRE_RANGES = [
  { slug: FICTION, range: 'fiction' },
  { slug: NON_FICTION, range: 'nonfiction' },
] as const satisfies readonly { slug: typeof FICTION; range: ShelfRange }[]

/**
 * What a save says about a book's genre. A save states the tag it means, so
 * there is no translation to get wrong between what the client sends and what
 * `book_tag` ends up holding.
 *
 * A save is allowed to state nothing, which is a book no genre tag claims. It
 * arrives here as `null` rather than as an absent key, so a caller cannot forget
 * to consider it.
 */
export interface StatedGenre {
  /** The slug this save states, or null when nothing has stated one. */
  genre: GenreSlug | null
  /** `manual` when somebody saved an edit. Anything else is the classifier. */
  classificationSource?: string
  classificationConfidence?: string
}

/**
 * The slug a request means, or null when it means neither of them. The two slugs
 * are read as themselves and everything else is null, which is the same answer
 * `rangeOfGenre` below gives for a book no genre tag claims.
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
 * row carries the range its genre settled on, and the field beside the title has
 * to come up showing the tag that agrees with it.
 *
 * It takes the column's own type, a string, rather than a `ShelfRange`, because
 * `books.shelf_range` holds `''` for a book that is in neither run, and reading
 * that back as `genre/non-fiction` would put a tag in the review pane that
 * nothing had said.
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
 * twice. A caller that could hold the range without the tag is a caller that can
 * write a `shelf_range` no tag agrees with.
 *
 * `manual` is a person and anything else is this app's inference, which is a
 * guess. A person is not guessing, so their confidence is `high` rather than
 * whatever the classifier last said.
 *
 * Both are null when the save states nothing: no tag is written, so there is no
 * tag for a range to agree with.
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
 * Null is a real answer, the same one `claim` in `domain/placement/rules.ts`
 * gives: a book no genre tag claims is a book the model cannot file, and saying
 * so is how somebody finds out. Guessing non-fiction because it is the other one
 * would put a book on a shelf nobody chose and report nothing.
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
