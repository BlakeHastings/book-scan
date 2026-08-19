/**
 * How many books each tag has, counting the ones under it.
 *
 * ## Why this is its own module and not a method on the repository
 *
 * It is both: `DrizzleBookRepository.tagCounts` calls this. The reason the
 * query lives here is that `server/furniture.ts` reads it too and cannot build
 * a `Store` — that takes an authorship port it has no use for — and
 * `book-repository.ts` reaches `server/photographs.ts` and `server/db.pg.ts`
 * for the row shapes it derives onto a page of books. Those two reach
 * `server/claim.ts`, which reaches `server/furniture.ts`, so a furniture module
 * importing the repository closes a loop through four files, and
 * `npm run lint:layers` says so by name.
 *
 * This query needs none of that. `Db`, the schema and the query renderer, and
 * `server/driver.ts` imports nothing at all. So the counting query sits where a
 * caller that is not a book reader can reach it, which is the smaller of the two
 * ways to have **one spelling of the query and two callers**: two counts of one
 * tag that agreed until somebody edited one of them is exactly how a screen ends
 * up saying "nothing carries this" beside a list of forty books.
 *
 * ## The rollup, and the range that does it
 *
 * The rollup is the point rather than an extra: choosing Fantasy shows the books
 * tagged Urban fantasy too, so a count that said 112 next to a list of 126 would
 * be the screen contradicting itself one tap later. `DISTINCT` because a book
 * carrying both is one book.
 *
 * At or under, as a range over the slug rather than a `LIKE`, which is the shape
 * `TagRepository.vocabulary` already uses and for the same reason: `tag.slug` is
 * `COLLATE "C"`, so a prefix is an index range. `/` is 0x2F and `0` is 0x30, so
 * everything under `genre/` sorts below `genre0`. The concatenation keeps the
 * column's collation, because a bare string literal has none of its own to bring.
 *
 * Catalogued books only, which is the same set the library draws, so the number
 * beside a tag is the number of rows choosing it produces.
 */

import { and, asc, eq, gte, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { bookTag, cataloguedBooks, tag } from '../db/schema'

export async function tagCounts(db: Db): Promise<{ slug: string; books: number }[]> {
  // The vocabulary twice: `tag` is the row being counted for and `descendant` is
  // every tag at or under it. Two aliases of one table, which is what the
  // hand-written statement this replaces spelled `t` and `d`.
  const descendant = alias(tag, 'd')

  const rollup = build
    .select({ books: sql<number>`cast(count(distinct ${bookTag.bookId}) as integer)` })
    .from(bookTag)
    .innerJoin(descendant, eq(descendant.id, bookTag.tagId))
    .innerJoin(cataloguedBooks, eq(cataloguedBooks.id, bookTag.bookId))
    .where(or(
      eq(descendant.slug, tag.slug),
      and(
        gte(descendant.slug, sql`${tag.slug} || '/'`),
        lt(descendant.slug, sql`${tag.slug} || '0'`),
      ),
    ))

  const query = statement(
    build.select({
      slug: tag.slug,
      books: sql<number>`(${rollup})`.as('books'),
    }).from(tag).orderBy(asc(tag.slug)),
  )
  return db.all<{ slug: string; books: number }>(query.text, query.values)
}
