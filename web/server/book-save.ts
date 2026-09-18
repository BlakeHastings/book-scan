/**
 * The two things every save does to a book besides writing its row: settle
 * the genre tag that files it, and keep its author credits in step.
 *
 * `createApp` and `scripts/seed-world.ts` both call these functions rather
 * than each writing their own version of what a save is.
 */

import { GENRE } from '../domain/tagging/catalogue-claims'
import { genreStatedBy, rangeOfGenre } from '../domain/tagging/genre'
import type { RestateTagsHandler } from '../application/tagging/restate-tags'
import type { TagRepository } from '../application/tagging/ports'
import type { CreditBookHandler } from '../application/authorship/credit-book'
import type { FileAliasHandler } from '../application/authorship/curate-authors'
import type { AuthorRepository } from '../application/authorship/ports'
import type { ShelfRange } from '../shared/shelving'
import type { DraftBook } from './store'

/**
 * Write what this save says a book is under, and answer the range that puts
 * it in. Runs before the row is written, and the range it returns is what
 * the row is written with.
 *
 * Restates rather than applies: it takes off only the tags of the source
 * doing the restating, so a lookup does not disturb a person's tag and a
 * person's answer does not leave a guess behind. The range comes from
 * reading the tags back afterwards, via `rangeOfGenre`, rather than from the
 * claim just made, since a book can carry both a person's genre and a
 * catalogue's and only that read says which one the shelf follows.
 *
 * A save that states nothing writes nothing and reads back whatever is
 * already there: an already-guessed genre is left alone rather than
 * withdrawn, and a book that has never had one answers null.
 */
export async function settleGenre(
  restateTags: RestateTagsHandler,
  tags: TagRepository,
  bookId: number,
  draft: DraftBook,
): Promise<ShelfRange | null> {
  const { tag } = genreStatedBy(draft)
  const now = new Date().toISOString()

  // Nothing stated, so nothing restated: an empty claim list here would mean
  // this source took back what it said before, which is not what a silent
  // lookup means.
  if (!tag) return rangeOfGenre(await tags.of(bookId))

  /*
   * `within: GENRE` scopes the restatement to genre tags only. Without it,
   * restating a source's claims would take back everything that source had
   * ever said about the book, including a tag applied by hand moments
   * before.
   */
  await restateTags.handle({
    bookId,
    source: tag.source,
    claims: [{ slug: tag.slug, confidence: tag.confidence }],
    within: GENRE,
    now,
  })

  // The guess is withdrawn once a person has answered, since leaving it would
  // show the book as both fiction and non-fiction with no way to tell which
  // is current. This is one-directional: a saved guess never removes a
  // person's answer.
  if (tag.source === 'person') {
    await restateTags.handle({ bookId, source: 'guess', claims: [], within: GENRE, now })
  }

  const settled = rangeOfGenre(await tags.of(bookId))
  // The claim above was either written or already there, so the book must
  // carry a genre tag by now; an absence here means the restatement did not
  // land, not a state the model allows.
  if (!settled) {
    throw new Error(`book ${bookId} carries no genre tag after a save that stated one`)
  }
  return settled
}

/**
 * Keep the credits in step with what was just saved about a book, and file
 * the first-listed name when somebody has said what it files under.
 *
 * Two calls, because they are two different statements about a name.
 * `introduce`, inside `creditBook`, sets a filing name only when the name is
 * new, so a re-save cannot undo somebody's correction; filing one explicitly
 * requires a name this collection has already met, which `introduce`
 * deliberately will not touch.
 */
export async function recordCredits(
  creditBook: CreditBookHandler,
  authors: AuthorRepository,
  fileAlias: FileAliasHandler,
  bookId: number,
  draft: DraftBook,
): Promise<void> {
  await creditBook.handle({
    bookId,
    authors: draft.authors,
    filingOverride: draft.authorFilingOverride,
  })

  const filing = draft.authorFilingOverride?.trim()
  if (!filing) return
  // The first-listed credit, because that is the one the shelf orders by and
  // the one the review pane's field is about. A save with no usable name
  // credits nobody, and there is then nothing to file.
  const [files] = await authors.creditsOf(bookId)
  if (files && files.filing !== filing) {
    await fileAlias.handle({ aliasId: files.id, filing })
  }
}
