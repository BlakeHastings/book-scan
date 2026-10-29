/**
 * `CoverTextReadModel` over Drizzle and `pg_trgm`, executed through `Db`.
 *
 * Two steps in one statement. Candidates first: the titles nearest the text by
 * trigram distance (`<->`, which is 1 - `similarity`), and the books of the
 * printed names nearest it, each a nearest-first walk of the GiST index
 * migration 0035 made rather than a comparison with every row. Then each
 * candidate's title and first author are scored against the whole text, two
 * ways:
 *
 *  - `similarity`, trigrams shared over trigrams in either, which is how alike
 *    the title and the reading are. The ranking is built from this.
 *  - `word_similarity`, how much of the title appears as one stretch of the
 *    reading, which is whether the title is printed there at all. A matcher's
 *    bar is built from this.
 *
 * Title and author are scored separately, so a photograph showing only an
 * author's name still finds that author's books.
 *
 * Only `catalogued_books`: a book scanned and not identified has no title to
 * be found by.
 */

import { and, eq, sql } from 'drizzle-orm'
import { union } from 'drizzle-orm/pg-core'
import type { CoverTextMatch, CoverTextReadModel } from '../../application/books/read-models'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { authorAlias, bookAuthor, cataloguedBooks } from '../db/schema'
import { folded } from './catalogue-read-model'

export class DrizzleCoverTextReadModel implements CoverTextReadModel {
  constructor(private readonly db: Db) {}

  async near(text: string, candidates: number): Promise<CoverTextMatch[]> {
    // Unfolded on the left of `<->`, because the index is over the column as
    // it is stored. pg_trgm folds case itself; only accents are lost here, and
    // they are restored to the comparison in the scores below.
    // The nearest names on their own, then their books: a nearest-first walk
    // cannot pass through a join.
    const names = build.$with('names').as(
      build.select({ id: authorAlias.id }).from(authorAlias)
        .orderBy(sql`${authorAlias.displayName} <-> ${text}`)
        .limit(candidates),
    )
    const hit = build.$with('hit').as(union(
      build.select({ id: cataloguedBooks.id }).from(cataloguedBooks)
        .orderBy(sql`${cataloguedBooks.title} <-> ${text}`)
        .limit(candidates),
      build.select({ id: bookAuthor.bookId }).from(names)
        .innerJoin(bookAuthor, and(eq(bookAuthor.authorAliasId, names.id), eq(bookAuthor.position, 1))),
    ))

    const title = folded(cataloguedBooks.title)
    const author = folded(authorAlias.displayName)
    const query = statement(build.with(names, hit).select({
      id: cataloguedBooks.id,
      title: cataloguedBooks.title,
      author: sql<string>`coalesce(${authorAlias.displayName}, '')`.as('author'),
      titleSimilarity: sql<number>`similarity(${title}, ${text})`.as('titleSimilarity'),
      authorSimilarity: sql<number>`coalesce(similarity(${author}, ${text}), 0)`.as('authorSimilarity'),
      titlePrinted: sql<number>`word_similarity(${title}, ${text})`.as('titlePrinted'),
    })
      .from(cataloguedBooks)
      .innerJoin(hit, eq(hit.id, cataloguedBooks.id))
      .leftJoin(bookAuthor, and(eq(bookAuthor.bookId, cataloguedBooks.id), eq(bookAuthor.position, 1)))
      .leftJoin(authorAlias, eq(authorAlias.id, bookAuthor.authorAliasId)))

    return this.db.all<CoverTextMatch>(query.text, query.values)
  }
}
