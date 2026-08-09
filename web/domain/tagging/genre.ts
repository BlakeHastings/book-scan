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
import { FICTION, NON_FICTION } from './catalogue-claims'
import type { AppliedTag, TagConfidence } from './tags'

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
 * What a save says about a book's genre, in the vocabulary the wire still uses.
 *
 * The boolean survives here and nowhere else. `web/src/lib/api.ts` still sends
 * `isFiction` and `books.is_fiction` is still written, so this is the one place
 * that translation happens; when the client sends a slug instead, this function
 * is what changes and nothing downstream of it does.
 */
export interface StatedGenre {
  isFiction: boolean
  /** `manual` when somebody saved an edit. Anything else is the classifier. */
  classificationSource?: string
  classificationConfidence?: string
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
 */
export function genreStatedBy(stated: StatedGenre): { tag: AppliedTag; range: ShelfRange } {
  const decidedByPerson = stated.classificationSource === 'manual'
  const { slug, range } = GENRE_RANGES[stated.isFiction ? 0 : 1]

  return {
    tag: {
      slug,
      source: decidedByPerson ? 'person' : 'guess',
      confidence: decidedByPerson ? 'high' : asConfidence(stated.classificationConfidence),
    },
    range,
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
 * Nothing that saves a book can reach it, because a save always states a genre
 * and therefore always writes one of the two tags. What can reach it is a book
 * whose genre tag was taken off afterwards, and `applySchema` counts those on
 * every start. Such a book keeps the `shelf_range` it already has and does not
 * move: the column is written by a save and by nothing else.
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
