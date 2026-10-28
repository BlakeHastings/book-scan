/**
 * The book's reads, over Drizzle, executed through `Db`.
 *
 * The SQL is generated from `infrastructure/db/schema.ts` rather than written
 * out, so a column renamed in the schema is a compile error here rather than a
 * statement that fails on somebody's shelf. `Db` still owns the connection, the
 * transaction and the advisory lock, and Drizzle never sees a connection. See
 * `infrastructure/db/query.ts`.
 *
 * Not one read here names `books`. `shelved_books`, `catalogued_books` and
 * `queued_books` exist so that the ordering code cannot forget a state filter,
 * and a read that named the table instead would pass every test that only ever
 * shelves books and would put an unidentified row in the middle of somebody's
 * library the first time one existed. `neighbours` reads `shelved_books`,
 * because a book that is not on a shelf is not something to put another book
 * beside; `listRange` and `checkedOut` read `catalogued_books`, which is
 * `shelved`, `checked_out` and `withdrawn`. The catalogue's own listing, counts
 * and lookups are `catalogue-read-model.ts` beside this file.
 *
 * `COLLATE "C"` is declared on the columns, through `collatedText` in
 * `schema.ts`, and no statement here writes an explicit `COLLATE` clause, so
 * what Drizzle builds is byte-ordered. `SHELF_ORDER_SQL` in `server/backup.ts`
 * is the one thing in this codebase that sees a collation change, because a
 * reordered shelf has the same row count as an ordered one.
 */

import { and, asc, desc, eq, gt, lt, ne, sql } from 'drizzle-orm'
import type { Db } from '../../server/driver'
import type { FiledBookRow } from '../../server/db.pg'
import { withPhotographs, type FiledPhotographedBook } from '../../server/photographs'
import { withPlacements, type PlacementFields } from '../../server/placement-ledger'
import type { Neighbour, ShelfRange } from '../../shared/shelving'
import { CHECKED_OUT } from '../../domain/books/state'
import { build, statement } from '../db/query'
import { bookPlacement, cataloguedBooks, shelvedBooks } from '../db/schema'

/**
 * A book as everything above this reads one: the view's row, with the
 * photographs and the placement derived onto it. Declared here rather than in
 * `server/store.ts`, which re-exports it, because this is where the rows are
 * read.
 */
export type FiledPlacedBook = FiledPhotographedBook & PlacementFields

export class DrizzleShelfReads {
  constructor(private readonly db: Db) {}

  /**
   * The core query pair. Both are covered by idx_books_shelved, so this stays
   * two index seeks no matter how large the collection gets.
   *
   * `excludeId` matters when previewing an edit to an already-saved book, so
   * it does not end up as its own neighbour.
   *
   * `shelved_books`, not `books`. These two statements are what decides which
   * physical books somebody is told to put a book between, so a row that is not
   * on a shelf reaching them is somebody standing at a bookcase looking for a
   * book that is not there. The view says which states once, so this cannot
   * forget.
   *
   * The two inequalities are the half of the ordering risk that `ORDER BY` does
   * not cover: placement does not sort, it seeks either side of a key, and an
   * index comparing differently from the query would answer the two questions
   * inconsistently. `sort_key` is `COLLATE "C"` on the column, so `<` and `>`
   * here compare bytes.
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
     * it is recognised by. Asking per book would be two more statements on the
     * path a person waits on while holding a book.
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
   * queue. The predicate is the view's and is not repeated here.
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
   * Books off the shelf, oldest first, so nothing is quietly forgotten.
   *
   * The complement of `shelved_books` is not one relation and there is no view
   * for it: `checked_out` is one of six states that are not `shelved`, and the
   * other five are not books somebody has taken out. So this names the state it
   * means rather than reading "everything the shelf does not show".
   *
   * `catalogued_books`, not `books`, and only for the joined filing name: the
   * state is stated here. See `FiledBookRow`.
   *
   * The moment a book left is the `checked_out` ledger row that took it out
   * rather than a column.
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
   * The photographs and the placement, derived onto a page of rows at once: two
   * statements for a page rather than two per book. The helpers live in
   * `server/` because that is where the flat one-per-slot shape the wire speaks
   * in is assembled.
   */
  private async draw(rows: FiledBookRow[]): Promise<FiledPlacedBook[]> {
    return withPlacements(this.db, await withPhotographs(this.db, rows))
  }
}

/**
 * A shelf row as the placement advice speaks about one.
 *
 * Exported for the one other place that has to name the two books a gap is
 * between: the plank a carried book is going onto, whose neighbours come off
 * that plank rather than out of the run. One reading, so the sentence about a
 * carried book is built the same way as the sentence about a scanned one.
 */
export function toNeighbour(row: FiledPlacedBook | undefined): Neighbour | null {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    authorFiling: row.author_filing,
    authors: row.authors,
    location: row.location,
    /*
     * The label's identity half, carried through rather than left behind.
     * `buildPlacement` reads it to decide whether two neighbours stand on one
     * plank, which comparing the two labels cannot do on a named piece.
     */
    areaId: row.area_id,
    sortKey: row.sort_key,
    images: {
      front: row.front_image,
      back: row.back_image,
      edge: row.edge_image,
    },
  }
}
