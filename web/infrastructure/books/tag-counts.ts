/**
 * How many books each tag has, counting the ones under it.
 *
 * Not a method on the repository, and it must not become one: `server/furniture.ts`
 * reads this too, and a furniture module importing `book-repository.ts` closes a
 * dependency loop through four files that `npm run lint:layers` fails by name.
 *
 * The rollup counts at or under the slug, as a range rather than a `LIKE`,
 * because `tag.slug` is `COLLATE "C"` and only a range is an index seek. `/` is
 * 0x2F and `0` is 0x30, so everything under `genre/` sorts below `genre0`. The
 * concatenation keeps the column's collation, since a bare string literal has
 * none of its own to bring. `DISTINCT` because a book carrying both a tag and
 * one under it is one book, and catalogued books only, so the number beside a
 * tag is the number of rows choosing it produces.
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
