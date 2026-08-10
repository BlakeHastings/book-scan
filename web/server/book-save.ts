/**
 * The two things every save does to a book besides writing its row: settle
 * the genre tag that files it, and keep its author credits in step.
 *
 * Pulled out of `server/index.ts` (#234) so a second caller can run the same
 * steps rather than restate them. `scripts/seed-world.ts` is that caller: a
 * seeded shelved book has to carry a genre tag and author credits the way a
 * real save leaves them, because those are what the current model derives a
 * book's shelf range and filing name from (#223, #227), and a seed that skips
 * them builds a world the app itself cannot place. AGENTS.md names #195 as
 * what a second copy of what a save does turns into, which is the trap this
 * file avoids: `createApp` and `seed-world.ts` both call these functions
 * rather than each writing their own version of what a save is.
 */

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
 * it in.
 *
 * **This is the cut-over (#223).** Until now the genre was written twice from
 * one draft, into `books.is_fiction` by `Store` and into `book_tag` here, and
 * the column was what decided the shelf range. Now the tag decides: this runs
 * *before* the row is written, and the range it returns is what the row is
 * written with.
 *
 * The source is the provenance the draft already carries, mapped by
 * `genreStatedBy`. Restating rather than applying is what makes an edit from
 * fiction to non-fiction take the old tag off, and it takes off only the tags
 * of the source doing the restating, so a person's tag is not disturbed by a
 * lookup and a guess is not left behind by a person.
 *
 * Reading the tags back rather than returning the range of the claim is the
 * point of the whole exercise: a book can carry a person's genre and a
 * catalogue's, and which of them the shelf follows is `rangeOfGenre`'s answer
 * rather than whatever this particular save happened to say.
 */
export async function settleGenre(
  restateTags: RestateTagsHandler,
  tags: TagRepository,
  bookId: number,
  draft: DraftBook,
): Promise<ShelfRange> {
  const { tag } = genreStatedBy(draft)
  const now = new Date().toISOString()

  await restateTags.handle({
    bookId,
    source: tag.source,
    claims: [{ slug: tag.slug, confidence: tag.confidence }],
    now,
  })

  // A person having answered, the guess is withdrawn: it was this app's
  // inference about the same question, and leaving it behind would show a book
  // as both fiction and non-fiction with no way to tell which is current. That
  // is the guess taking back its own claim, which is the only thing it is
  // allowed to do, and it is why the person's row is written first.
  //
  // The other way round is not this function's to do and never will be. A
  // saved guess leaves a person's answer exactly where it is; the only thing
  // that takes one off is the book turning out to be a different book, which
  // `PUT /api/books/:id` settles before this runs (#194).
  if (tag.source === 'person') {
    await restateTags.handle({ bookId, source: 'guess', claims: [], now })
  }

  const settled = rangeOfGenre(await tags.of(bookId))
  // The claim above was either written or already there, so the book carries
  // a genre tag by the time this reads. Nothing here is guarding against a
  // state the model allows: an absence would mean the restatement did not
  // land, which is a broken write and not a book to file somewhere anyway.
  if (!settled) {
    throw new Error(`book ${bookId} carries no genre tag after a save that stated one`)
  }
  return settled
}

/**
 * Keep the credits in step with what was just saved about a book, and file
 * the first-listed name when somebody has said what it files under.
 *
 * **This is `Store.saveFilingOverride`, arrived at the alias** (#227). That
 * method wrote the `author_filing` override table, which `Store.filingFor`
 * consulted on the next save; the alias holds the same fact now, so the
 * correction is written where the shelf reads it.
 *
 * Two calls, because they are two different statements about a name.
 * `introduce`, inside `creditBook`, sets a filing name only when the name is
 * new, which is what stops a re-save undoing somebody's correction. Filing one
 * is somebody saying so, and it has to reach a name this collection has
 * already met, which is the case `introduce` deliberately will not touch.
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
