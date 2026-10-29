/**
 * Recognising a cover by the words printed on it: PaddleOCR reads the
 * photograph, and `MatchCoverTextHandler` looks the words up in titles and
 * authors' names with `pg_trgm`, through the read model the app will use.
 *
 * Measured end to end on purpose. The catalogue is saved into a real Postgres
 * by the app's own save path, and the photograph is read by the same
 * `paddleOcr` the ISBN path runs on it, so this row is what the scan route
 * would get rather than a model of it.
 *
 * Paddle alone, not the tesseract ladder: on the synthetic set Paddle read
 * 61% of the words of four letters or more exactly at about 180 ms a
 * photograph, and tesseract's whole-frame pass read 4% at about 430 ms,
 * because a cover in a photograph is turned and tesseract's layout analysis
 * does not find turned lines. See `docs/the-cover-matcher.md`.
 */

import { MatchCoverTextHandler } from '../../application/books/queries/match-cover-text'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DrizzleCoverTextReadModel } from '../../infrastructure/books/cover-text-read-model'
import { paddleOcr } from '../paddle'
import { testBooks } from '../testbooks'
import { catalogueDatabase } from './catalogue-database'
import type { CoverMatcher } from './matcher'

export interface TextBar {
  /** How much of its title the best candidate must have on the cover. */
  title: number
  /** How far ahead of the second it must be, on the combined score. */
  margin: number
}

export function coverTextMatcher(bar: TextBar): CoverMatcher {
  return {
    name: 'cover text (paddle, pg_trgm)',
    bar: `best has >= ${bar.title} of its title printed on the cover and leads the second by >= ${bar.margin}`,

    async prepare(catalogue) {
      const db = await catalogueDatabase()
      const books = testBooks(db)
      const harnessId = new Map<number, string>()
      for (const book of catalogue) {
        const saved = await books.catalogue({
          title: book.title,
          authors: book.author ? [book.author] : [],
          genre: FICTION_SLUG,
        })
        harnessId.set(saved.id, book.id)
      }
      const handler = new MatchCoverTextHandler(new DrizzleCoverTextReadModel(db))

      return async (photo) => {
        const read = await paddleOcr(photo)
        const ranked = await handler.handle({ text: read?.text ?? '', limit: 4 })
        const [first, second] = ranked
        const clear = first !== undefined
          && first.titlePrinted >= bar.title
          && first.score - (second?.score ?? 0) >= bar.margin
        const id = (bookId: number) => harnessId.get(bookId) ?? String(bookId)
        return {
          candidates: ranked.map((candidate) => ({ id: id(candidate.id), score: candidate.score })),
          confident: clear ? id(first.id) : null,
        }
      }
    },
  }
}
