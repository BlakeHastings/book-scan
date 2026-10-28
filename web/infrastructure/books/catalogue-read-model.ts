/**
 * `CatalogueReadModel` over Drizzle, executed through `Db`.
 *
 * Every read here but `detail` names `catalogued_books`, which is `shelved`,
 * `checked_out` and `withdrawn`: a book that has been scanned and not
 * identified has no title, no author and no shelf range, and it is already on
 * screen in the queue. `detail` is a lookup by id and reads `books`, so it
 * answers a queued or discarded book too, which is what the review pane and
 * every write route's existence check rely on.
 */

import {
  and, asc, eq, gte, isNotNull, isNull, lt, ne, or, sql, type SQL, type SQLWrapper,
} from 'drizzle-orm'
import type {
  BookView, CatalogueCounts, CatalogueFilter, CatalogueReadModel, CataloguedBookView, Page,
} from '../../application/books/read-models'
import type { Db } from '../../server/driver'
import type { BookRow, FiledBookRow } from '../../server/db.pg'
import { withPhotographs, withPhotographsOf, type PhotographedBook } from '../../server/photographs'
import {
  withPlacements, withPlacementsOf, type PlacementFields,
} from '../../server/placement-ledger'
import { resolveIsbnPair } from '../../shared/isbn'
import { CHECKED_OUT, SHELVED } from '../../domain/books/state'
import { build, statement } from '../db/query'
import { authorAlias, bookAuthor, bookTag, cataloguedBooks, tag } from '../db/schema'
import type { FiledPlacedBook } from './book-repository'

/** A book read by id: the table's row, which has no filing name, with the rest derived. */
export type PlacedPhotographedBook = PhotographedBook & PlacementFields

/*
 * Folding, so `mieville` finds Miéville.
 *
 * A translation pair rather than `unaccent`, which is an extension this database
 * is not guaranteed to have and would be a migration and a privilege for one
 * `LIKE`. A name in a script with no fold at all is matched as it is written.
 *
 * The two strings are one character to one character and the same length. A
 * ligature has no single-character fold, so none is attempted here.
 */
const FOLD_FROM = 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçćšžýÿ'
const FOLD_TO = 'aaaaaaaeeeeeiiiiiooooooouuuuunccszyy'

/** The same fold in SQL, over whichever column is being searched. */
function folded(column: SQLWrapper): SQL {
  return sql`translate(lower(${column}), ${FOLD_FROM}, ${FOLD_TO})`
}

/**
 * The same fold in TypeScript, over what somebody typed. Both sides have to
 * agree or the search silently answers nothing, which is why this sits against
 * the statement rather than in a helper file.
 *
 * `%` and `_` are escaped rather than dropped. They are the two characters
 * `LIKE` reads as a pattern, and a title with a percent sign in it is a real
 * book somebody should be able to find.
 */
export function wordsOf(typed: string): string[] {
  return typed
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .split(/\s+/)
    .map((word) => word.trim().replace(/([\\%_])/g, '\\$1'))
    .filter(Boolean)
    // Six is more words than any title anybody types, and it bounds the number
    // of clauses a single request can ask the database to run.
    .slice(0, 6)
}

export class DrizzleCatalogueReadModel implements CatalogueReadModel {
  constructor(private readonly db: Db) {}

  /**
   * Words are matched against the title, the printed names and the name the book
   * files under, folded. Tags must all be carried, itself or under, so choosing
   * Fantasy finds the book somebody tagged Urban fantasy.
   */
  async list(
    filter: CatalogueFilter,
    page: Page,
  ): Promise<{ books: FiledPlacedBook[]; total: number }> {
    const where = conditionsFor(filter)

    const counted = statement(
      build.select({ total: sql<number>`cast(count(*) as integer)`.as('total') })
        .from(cataloguedBooks).where(where),
    )
    const total = await this.db.get<{ total: number }>(counted.text, counted.values)

    // Range first, so a listing of the whole collection runs fiction then
    // non-fiction, which is the order the bookcases stand in.
    const rows = build.select().from(cataloguedBooks).where(where)
      .orderBy(asc(cataloguedBooks.shelfRange), asc(cataloguedBooks.sortKey))
      .limit(page.limit)
    if (page.offset) rows.offset(page.offset)

    const query = statement(rows)
    return {
      books: await withPlacements(this.db, await withPhotographs(
        this.db, await this.db.all<FiledBookRow>(query.text, query.values),
      )),
      total: total?.total ?? 0,
    }
  }

  /**
   * Two dialect-neutrality details here, both of which are silent when wrong.
   *
   * The CASTs: COUNT and SUM are wider than an int, and a driver that refuses to
   * narrow them hands back a string rather than lose precision. A total of "57"
   * would render identically and fail every piece of arithmetic downstream.
   *
   * The quoted "checkedOut": an unquoted alias is folded to lower case, so the
   * one camelCase name here has to say it means that. `sql`...`.as(name)` quotes.
   */
  async counts(): Promise<CatalogueCounts> {
    const tally = (when: SQL) =>
      sql<number>`cast(sum(case when ${when} then 1 else 0 end) as integer)`

    const query = statement(build.select({
      total: sql<number>`cast(count(*) as integer)`.as('total'),
      fiction: tally(eq(cataloguedBooks.shelfRange, 'fiction')).as('fiction'),
      nonfiction: tally(eq(cataloguedBooks.shelfRange, 'nonfiction')).as('nonfiction'),
      checkedOut: tally(eq(cataloguedBooks.state, CHECKED_OUT)).as('checkedOut'),
      // Must stay the predicate `placed: false` narrows a listing by.
      unplaced: tally(and(
        eq(cataloguedBooks.state, SHELVED),
        isNull(cataloguedBooks.currentAreaId),
      )!).as('unplaced'),
    }).from(cataloguedBooks))

    const row = await this.db.get<{
      total: number; fiction: number | null
      nonfiction: number | null; checkedOut: number | null; unplaced: number | null
    }>(query.text, query.values)

    return {
      total: row?.total ?? 0,
      fiction: row?.fiction ?? 0,
      nonfiction: row?.nonfiction ?? 0,
      checkedOut: row?.checkedOut ?? 0,
      unplaced: row?.unplaced ?? 0,
    }
  }

  /** The oldest catalogued book with this number, so a duplicate check has one answer. */
  async findByIsbn(value: string): Promise<FiledPlacedBook | null> {
    const { isbn13, isbn10 } = resolveIsbnPair(value)
    if (!isbn13 && !isbn10) return null

    return (await withPlacementsOf(this.db, await withPhotographsOf(this.db,
      await this.db.get<FiledBookRow>(
        `SELECT * FROM catalogued_books
          WHERE (isbn13 != '' AND isbn13 = :isbn13)
             OR (isbn10 != '' AND isbn10 = :isbn10)
          ORDER BY id LIMIT 1`,
        { isbn13, isbn10 },
      )))) ?? null
  }

  async detail(id: number): Promise<PlacedPhotographedBook | null> {
    return (await withPlacementsOf(this.db, await withPhotographsOf(
      this.db,
      await this.db.get<BookRow>('SELECT * FROM books WHERE id = ?', [id]),
    ))) ?? null
  }
}

/*
 * The port's shapes and the rows' are one shape. `implements` above proves the
 * rows carry everything the port names; these prove the port names everything
 * the rows carry, so a column added to the wire and not to the port fails here
 * rather than going missing for an adapter that trusted the type.
 */
const portNamesEveryColumn: (view: BookView) => PlacedPhotographedBook = (view) => view
const portNamesEveryViewColumn: (view: CataloguedBookView) => FiledPlacedBook = (view) => view
void portNamesEveryColumn
void portNamesEveryViewColumn

/** The narrowing a listing asks for, as one `where` or none at all. */
function conditionsFor(filter: CatalogueFilter): SQL | undefined {
  const conditions: SQL[] = []

  if (filter.range) conditions.push(eq(cataloguedBooks.shelfRange, filter.range))

  if (filter.state) conditions.push(eq(cataloguedBooks.state, filter.state))

  if (filter.placed === false) {
    conditions.push(eq(cataloguedBooks.state, SHELVED))
    conditions.push(isNull(cataloguedBooks.currentAreaId))
  } else if (filter.placed === true) {
    conditions.push(isNotNull(cataloguedBooks.currentAreaId))
  }

  if (filter.isbn) {
    const pair = resolveIsbnPair(filter.isbn)
    // Both forms, because a person types whichever is printed on the book and
    // the catalogue may hold the other. An unresolvable number matches nothing
    // rather than everything, which is the honest answer to thirteen digits
    // that are not an ISBN.
    conditions.push(or(
      and(
        eq(cataloguedBooks.isbn13, pair.isbn13 || filter.isbn),
        ne(cataloguedBooks.isbn13, ''),
      ),
      and(
        eq(cataloguedBooks.isbn10, pair.isbn10 || filter.isbn),
        ne(cataloguedBooks.isbn10, ''),
      ),
    )!)
  }

  for (const word of wordsOf(filter.words ?? '')) {
    const like = `%${word}%`
    conditions.push(or(
      sql`${folded(cataloguedBooks.title)} like ${like}`,
      sql`${folded(cataloguedBooks.authors)} like ${like}`,
      sql`${folded(cataloguedBooks.authorFiling)} like ${like}`,
    )!)
  }

  for (const { value: slug } of filter.tags ?? []) {
    /*
     * At or under, as a range over the slug rather than a `LIKE`, for the reason
     * `tag-counts.ts` gives: the slug is ordered `COLLATE "C"`, so a prefix is an
     * index range.
     */
    const carried = build.select({ one: sql`1` }).from(bookTag)
      .innerJoin(tag, eq(tag.id, bookTag.tagId))
      .where(and(
        eq(bookTag.bookId, cataloguedBooks.id),
        or(
          eq(tag.slug, slug),
          and(gte(tag.slug, `${slug}/`), lt(tag.slug, `${slug}0`)),
        ),
      ))
    conditions.push(sql`exists (${carried})`)
  }

  if (filter.authorId !== undefined) {
    // Asked of the person rather than one name, so a pseudonym's books come back too.
    const credited = build.select({ one: sql`1` }).from(bookAuthor)
      .innerJoin(authorAlias, eq(authorAlias.id, bookAuthor.authorAliasId))
      .where(and(
        eq(bookAuthor.bookId, cataloguedBooks.id),
        eq(authorAlias.authorId, filter.authorId),
      ))
    conditions.push(sql`exists (${credited})`)
  }

  return conditions.length ? and(...conditions) : undefined
}
