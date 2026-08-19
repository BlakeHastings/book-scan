/**
 * The book's reads, over Drizzle, executed through `Db`.
 *
 * The first slice of the book aggregate (#424, under #169), and deliberately
 * the half with no write path in it: no `sort_key` is built here, no placement
 * is recorded, no transaction is opened. Six methods came across from
 * `server/store.ts` unchanged in what they answer, and `Store` now calls them.
 *
 * It is built the way #172 established and the four repositories before this
 * one follow: the SQL is generated from `infrastructure/db/schema.ts` rather
 * than written out, so a column renamed in the schema is a compile error here
 * rather than a statement that fails on somebody's shelf, and `Db` still owns
 * the connection, the transaction and the advisory lock. Drizzle never sees a
 * connection. See `infrastructure/db/query.ts` for why that is.
 *
 * ## The three views, and why not one of these reads names `books`
 *
 * `shelved_books`, `catalogued_books` and `queued_books` exist so that the
 * ordering code cannot forget a state filter, which is the whole answer to the
 * risk #183 took on when the queue table dissolved into states on `books`. A
 * read here that named the table instead would pass every test that only ever
 * shelves books and would put an unidentified row in the middle of somebody's
 * library the first time one existed. So:
 *
 * - `neighbours` reads **`shelved_books`**, because a book that is not on a
 *   shelf is not something to put another book beside.
 * - `listRange`, `listing` and `counts` read **`catalogued_books`**, which is
 *   `shelved`, `checked_out` and `withdrawn`. A queued row has no title to list
 *   and nothing to file it under.
 * - `checkedOut` reads **`catalogued_books`** for the joined filing name only.
 *   The state is still stated in the `where`, exactly as it always was.
 * - `tagCounts` counts over **`catalogued_books`**, which is the same set the
 *   library draws, so the number beside a tag is the number of rows choosing it
 *   produces.
 *
 * Every one of those is the relation the statement named in `Store`. This move
 * changed no `from`, and the generated SQL was read back and checked against
 * that list rather than assumed.
 *
 * ## `COLLATE "C"` survived, and here is why it could
 *
 * Drizzle has no `.collate()` on any column builder, so `schema.ts` declares
 * `sort_key`, `title_filing`, `slug`, `filing_name` and `starts_at` through
 * `collatedText`, a custom type whose `dataType` is the literal
 * `text COLLATE "C"`. A collation declared on a column is what `ORDER BY
 * sort_key` and `sort_key < ?` use unless something overrides it, and none of
 * the statements moved here ever wrote an explicit `COLLATE` clause. So what
 * Drizzle builds — `order by "catalogued_books"."sort_key"`, `"sort_key" < $1`
 * — is byte-ordered for exactly the reason the hand-written text was.
 *
 * That is an argument, and an argument is not a check. The check is the shelf
 * order hash: `SHELF_ORDER_SQL` in `server/backup.ts` is the one thing in this
 * codebase that sees a collation change, because a reordered shelf has the same
 * row count as an ordered one. The pull request that moved these ran the same
 * seeded world through the readers before and after and compared the hash of
 * the id sequence each one answered with, not the number of rows. See #424.
 *
 * ## A page of view columns, not `SELECT *`
 *
 * Drizzle spells out the column list, where the statements here said `*`. The
 * two are the same list only because the views are `getTableColumns(books)`
 * plus the joined `author_filing`, and because `migrate.test.ts` diffs the
 * schema this file reads against the migration chain the catalogue was built
 * from. If those ever part company the drift check in `applySchema` reports it
 * and does not repair it, so the log line is the warning and the failing test
 * is `migrate.test.ts`, not this file.
 */

import {
  and, asc, desc, eq, gt, gte, lt, ne, or, sql, type SQL, type SQLWrapper,
} from 'drizzle-orm'
import type { Db } from '../../server/driver'
import type { FiledBookRow } from '../../server/db.pg'
import { withPhotographs, type FiledPhotographedBook } from '../../server/photographs'
import { withPlacements, type PlacementFields } from '../../server/placement-ledger'
import type { Neighbour, ShelfRange } from '../../shared/shelving'
import { resolveIsbnPair } from '../../shared/isbn'
import { CHECKED_OUT } from '../../domain/books/state'
import { build, statement } from '../db/query'
import { tagCounts } from './tag-counts'
import { bookPlacement, bookTag, cataloguedBooks, shelvedBooks, tag } from '../db/schema'

/**
 * A book as everything above this reads one: the view's row, with the
 * photographs and the placement derived onto it.
 *
 * Declared here rather than in `server/store.ts`, which re-exports it, because
 * this is where the rows are read now and a type that outlives its reader is
 * how two shapes end up meaning one thing.
 */
export type FiledPlacedBook = FiledPhotographedBook & PlacementFields

/**
 * The most books one listing answers with, asked for or not.
 *
 * Both halves of that, and it is the point of the number (#332). It is the cap a
 * stated `limit` is clamped to, and since #332 it is also what an absent one
 * means, so "the largest page" and "the page you get for not asking" cannot
 * drift apart. It was already the clamp; what it was not was the default, and an
 * absent limit meant every matching row.
 */
export const PAGE_LIMIT = 500

/**
 * What a listing is being asked for, beyond "everything".
 *
 * Every field is optional and an absent one narrows nothing, so `{}` is the
 * whole catalogue narrowed by nothing, and `{ range }` is what `listRange` has
 * always answered, up to one page of it.
 */
export interface Listing {
  /** One run of the collection. Absent means both, in bookcase order. */
  range?: ShelfRange | null
  /** Titles and the names on the cover, near enough rather than exact. */
  words?: string
  /** Either form of the number. At most one answer. */
  isbn?: string
  /** Slugs, all of which the book must carry, itself or under. */
  tags?: readonly string[]
  /** How many rows this page holds. Absent means `PAGE_LIMIT` of them. */
  limit?: number
  offset?: number
}

/*
 * Folding, so `mieville` finds Miéville.
 *
 * Written as a translation pair rather than reached for with `unaccent`, which
 * is an extension this database is not guaranteed to have and would be a
 * migration and a privilege for one `LIKE`. What it covers is the accented
 * Latin letters a European collection actually carries; a name in a script with
 * no fold at all is matched as it is written, which is what somebody typing it
 * would type anyway.
 *
 * The two strings are one character to one character and the same length. A
 * ligature has no single-character fold, so none is attempted here.
 */
const FOLD_FROM = 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçćšžýÿ'
const FOLD_TO = 'aaaaaaaeeeeeiiiiiooooooouuuuunccszyy'

/**
 * The same fold in SQL, over whichever column is being searched.
 *
 * The two strings arrive as parameters rather than as literals in the text,
 * which is the one thing about this that is not character for character what
 * `server/store.ts` sent. `translate` reads them the same either way, and a
 * pair of accented alphabets is a value rather than a piece of syntax.
 */
function folded(column: SQLWrapper): SQL {
  return sql`translate(lower(${column}), ${FOLD_FROM}, ${FOLD_TO})`
}

/**
 * The same fold in TypeScript, over what somebody typed.
 *
 * Both sides have to agree or the search silently answers nothing, which is why
 * this sits against the statement rather than in a helper file: NFD and a
 * translation table are two spellings of one decision.
 *
 * `%` and `_` are escaped rather than dropped. They are the two characters
 * `LIKE` reads as a pattern, and a title with a percent sign in it is a real
 * book somebody should be able to find.
 */
export function wordsOf(typed: string): string[] {
  return typed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .split(/\s+/)
    .map((word) => word.trim().replace(/([\\%_])/g, '\\$1'))
    .filter(Boolean)
    // Six is more words than any title anybody types, and it bounds the number
    // of clauses a single request can ask the database to run.
    .slice(0, 6)
}

export class DrizzleBookRepository {
  constructor(private readonly db: Db) {}

  /**
   * The core query pair. Both are covered by idx_books_shelved, so this stays
   * two index seeks no matter how large the collection gets.
   *
   * `excludeId` matters when previewing an edit to an already-saved book, so
   * it does not end up as its own neighbour.
   *
   * **`shelved_books`, not `books`, and that is not a rename.** These two
   * statements are what decides which physical books somebody is told to put a
   * book between, so a row that is not on a shelf reaching them is somebody
   * standing at a bookcase looking for a book that is not there. The condition
   * used to be `checked_out_at IS NULL`, written out here and in three other
   * statements, and #183 gave books six more states that must not reach a shelf.
   * Saying which states in every query is the arrangement that lasts until the
   * next query is written, so the view says it once and this cannot forget. See
   * `shelvedBooks` in infrastructure/db/schema.ts.
   *
   * The two inequalities are the half of the ordering risk that `ORDER BY` does
   * not cover: placement does not sort, it seeks either side of a key, and an
   * index comparing differently from the query would answer the two questions
   * inconsistently. `sort_key` is `COLLATE "C"` on the column, so `<` and `>`
   * here compare bytes exactly as the hand-written statements did.
   */
  async neighbours(
    range: ShelfRange,
    sortKey: string,
    excludeId?: number,
  ): Promise<{ predecessor: Neighbour | null; successor: Neighbour | null }> {
    const exclude = excludeId ?? -1

    const before = statement(
      build.select().from(shelvedBooks).where(and(
        eq(shelvedBooks.shelfRange, range),
        lt(shelvedBooks.sortKey, sortKey),
        ne(shelvedBooks.id, exclude),
      )).orderBy(desc(shelvedBooks.sortKey)).limit(1),
    )
    const predecessor = await this.db.get<FiledBookRow>(before.text, before.values)

    const after = statement(
      build.select().from(shelvedBooks).where(and(
        eq(shelvedBooks.shelfRange, range),
        gt(shelvedBooks.sortKey, sortKey),
        ne(shelvedBooks.id, exclude),
      )).orderBy(asc(shelvedBooks.sortKey)).limit(1),
    )
    const successor = await this.db.get<FiledBookRow>(after.text, after.values)

    /*
     * One statement for both, because a neighbour is drawn with the photograph
     * it is recognised by and the photographs are rows now. Asking per book
     * would be two more statements on the path a person waits on while holding a
     * book, where this is one.
     */
    const drawn = await withPlacements(this.db, await withPhotographs(
      this.db,
      [predecessor, successor].filter((row): row is FiledBookRow => Boolean(row)),
    ))

    return {
      predecessor: toNeighbour(drawn.find((row) => row.id === predecessor?.id)),
      successor: toNeighbour(drawn.find((row) => row.id === successor?.id)),
    }
  }

  /**
   * One whole run of the collection, in the one order the model says it is in.
   *
   * `catalogued_books`, not `books`: a book that has been scanned and not
   * identified has no title, no author and no shelf range, so there is nothing
   * to list and nothing to file it under, and it is already on screen in the
   * queue, which is the place built to show it and the only place anybody can
   * act on it.
   *
   * The predicate is the view's and is not repeated here, for the reason
   * `shelved_books` exists: eight statements meant "the catalogue", and eight
   * places to remember which states that is are eight places to forget one.
   */
  async listRange(range: ShelfRange): Promise<FiledPlacedBook[]> {
    const query = statement(
      build.select().from(cataloguedBooks)
        .where(eq(cataloguedBooks.shelfRange, range))
        .orderBy(asc(cataloguedBooks.sortKey)),
    )
    return this.draw(await this.db.all<FiledBookRow>(query.text, query.values))
  }

  /**
   * The same listing, asked a narrower question and a page at a time.
   *
   * `listRange` is this with a range and nothing else, and it is left alone: the
   * shelving screens ask for a whole run and are entitled to it. What this adds
   * is the four things the library and the find screen ask, which the catalogue
   * could not answer at all before:
   *
   * - **words**, matched against the title, the printed names and the name the
   *   book files under, folded so `mieville` finds Miéville. That is not a
   *   contrived example: it is what somebody types on a phone keyboard, and an
   *   exact match answers nothing and is wrong.
   * - **an ISBN**, in either form, which has at most one answer.
   * - **tags**, all of which the book must carry, itself or under: choosing
   *   Fantasy finds the book somebody tagged Urban fantasy, because the
   *   hierarchy is in the slug and `under` is the question a person is asking.
   * - **a page**, because this is the screen with the most books on it and
   *   answering with the whole collection is what stops being possible first.
   *
   * `total` is what the query matches rather than what the page holds, because
   * the screen says "6 of 1,204" and the second number is not `books.length`.
   *
   * ## An absent `limit` is the largest page, not every book (#332)
   *
   * It used to mean no `LIMIT` clause at all, so `GET /api/books?range=all` was
   * 1204 KB at 1200 books, about a kilobyte each, unbounded, over somebody's
   * mobile data. `PAGE_LIMIT` is the cap a stated limit was already clamped to,
   * so what you get for asking for everything and what you get for asking for
   * too much are now one number defined once, rather than one number and no
   * number.
   */
  async listing(query: Listing): Promise<{ books: FiledPlacedBook[]; total: number }> {
    const where = conditionsFor(query)

    const counted = statement(
      build.select({ total: sql<number>`cast(count(*) as integer)`.as('total') })
        .from(cataloguedBooks).where(where),
    )
    const total = await this.db.get<{ total: number }>(counted.text, counted.values)

    // Range first, so a listing of the whole collection runs fiction then
    // non-fiction, which is the order the bookcases stand in.
    const page = build.select().from(cataloguedBooks).where(where)
      .orderBy(asc(cataloguedBooks.shelfRange), asc(cataloguedBooks.sortKey))
      .limit(query.limit === undefined
        ? PAGE_LIMIT
        : Math.max(1, Math.min(PAGE_LIMIT, Math.floor(query.limit))))
    if (query.offset) page.offset(Math.max(0, Math.floor(query.offset)))

    const rows = statement(page)
    return {
      books: await this.draw(await this.db.all<FiledBookRow>(rows.text, rows.values)),
      total: total?.total ?? 0,
    }
  }

  /**
   * Books off the shelf, oldest first, so nothing is quietly forgotten.
   *
   * The complement of `shelved_books` is not one relation and there is no view
   * for it: `checked_out` is one of six states that are not `shelved`, and the
   * other five are not books somebody has taken out. So this names the state it
   * means rather than reading "everything the shelf does not show".
   *
   * `catalogued_books`, not `books`, and only for the joined filing name: the
   * state is stated here as it always was. See `FiledBookRow`.
   *
   * Oldest first is the point of the listing, and the moment a book left is the
   * `checked_out` row that took it out rather than a column (#232).
   */
  async checkedOut(): Promise<FiledPlacedBook[]> {
    const wentOut = build.select({ id: bookPlacement.id }).from(bookPlacement)
      .where(and(
        eq(bookPlacement.bookId, cataloguedBooks.id),
        eq(bookPlacement.kind, 'checked_out'),
      ))
      .orderBy(desc(bookPlacement.id)).limit(1)

    const query = statement(
      build.select().from(cataloguedBooks)
        .where(eq(cataloguedBooks.state, CHECKED_OUT))
        .orderBy(sql`(${wentOut}) asc nulls last`, asc(cataloguedBooks.id)),
    )
    return this.draw(await this.db.all<FiledBookRow>(query.text, query.values))
  }

  /**
   * Two dialect-neutrality details here, both of which are silent when wrong.
   *
   * The CASTs: COUNT and SUM are wider than an int in every real database, and
   * a driver that refuses to narrow them hands back a string rather than lose
   * precision. `/api/health` and every save response carry these numbers, so a
   * total of "57" would render identically and fail every piece of arithmetic
   * downstream. Casting says what the caller actually wants.
   *
   * The quoted "checkedOut": an unquoted alias is folded to a single case by
   * some dialects and preserved verbatim by others, so the one camelCase name
   * here has to say it means that. `sql`...`.as(name)` quotes, which is
   * understood everywhere.
   */
  async counts(): Promise<{
    total: number; fiction: number; nonfiction: number; checkedOut: number
  }> {
    const tally = (when: SQL) =>
      sql<number>`cast(sum(case when ${when} then 1 else 0 end) as integer)`

    const query = statement(build.select({
      total: sql<number>`cast(count(*) as integer)`.as('total'),
      fiction: tally(eq(cataloguedBooks.shelfRange, 'fiction')).as('fiction'),
      nonfiction: tally(eq(cataloguedBooks.shelfRange, 'nonfiction')).as('nonfiction'),
      checkedOut: tally(eq(cataloguedBooks.state, CHECKED_OUT)).as('checkedOut'),
    }).from(cataloguedBooks))

    const row = await this.db.get<{
      total: number; fiction: number | null
      nonfiction: number | null; checkedOut: number | null
    }>(query.text, query.values)

    return {
      total: row?.total ?? 0,
      fiction: row?.fiction ?? 0,
      nonfiction: row?.nonfiction ?? 0,
      checkedOut: row?.checkedOut ?? 0,
    }
  }

  /**
   * How many books each tag has, counting the ones under it.
   *
   * The query is in `tag-counts.ts` beside this file rather than in it, because
   * `server/furniture.ts` reads the same answer and importing this module from
   * there would close a cycle. The reasoning is written out at the top of that
   * file; this is the same query under the name a caller of the repository
   * expects to find it.
   */
  tagCounts(): Promise<{ slug: string; books: number }[]> {
    return tagCounts(this.db)
  }

  /**
   * The photographs and the placement, derived onto a page of rows at once.
   *
   * Two statements for a page rather than two per book, which is what the two
   * `withX` helpers are for. They live in `server/` because that is where the
   * flat one-per-slot shape the wire speaks in is assembled; see the note at the
   * top of `server/store.ts`.
   */
  private async draw(rows: FiledBookRow[]): Promise<FiledPlacedBook[]> {
    return withPlacements(this.db, await withPhotographs(this.db, rows))
  }
}

/** The narrowing a listing asks for, as one `where` or none at all. */
function conditionsFor(query: Listing): SQL | undefined {
  const conditions: SQL[] = []

  if (query.range) conditions.push(eq(cataloguedBooks.shelfRange, query.range))

  if (query.isbn) {
    const pair = resolveIsbnPair(query.isbn)
    // Both forms, because a person types whichever is printed on the book and
    // the catalogue may hold the other. An unresolvable number matches nothing
    // rather than everything, which is the honest answer to thirteen digits
    // that are not an ISBN.
    conditions.push(or(
      and(
        eq(cataloguedBooks.isbn13, pair.isbn13 || query.isbn),
        ne(cataloguedBooks.isbn13, ''),
      ),
      and(
        eq(cataloguedBooks.isbn10, pair.isbn10 || query.isbn),
        ne(cataloguedBooks.isbn10, ''),
      ),
    )!)
  }

  for (const word of wordsOf(query.words ?? '')) {
    const like = `%${word}%`
    conditions.push(or(
      sql`${folded(cataloguedBooks.title)} like ${like}`,
      sql`${folded(cataloguedBooks.authors)} like ${like}`,
      sql`${folded(cataloguedBooks.authorFiling)} like ${like}`,
    )!)
  }

  for (const slug of query.tags ?? []) {
    /*
     * At or under, as a range over the slug rather than a `LIKE`, for the reason
     * `tagCounts` gives: the slug is ordered `COLLATE "C"`, so a prefix is an
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

  return conditions.length ? and(...conditions) : undefined
}

/** A shelf row as the placement advice speaks about one. */
function toNeighbour(row: FiledPlacedBook | undefined): Neighbour | null {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    authorFiling: row.author_filing,
    authors: row.authors,
    location: row.location,
    sortKey: row.sort_key,
    images: {
      front: row.front_image,
      back: row.back_image,
      edge: row.edge_image,
    },
  }
}
