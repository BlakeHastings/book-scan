/**
 * `CaptureRepository` over Drizzle, executed through `Db`.
 *
 * The third slice built the way #172 established: the SQL is generated from
 * `infrastructure/db/schema.ts` rather than written out, so a column renamed in
 * the schema is a compile error here rather than a statement that fails on
 * somebody's shelf, and `Db` still owns the connection, the transaction and the
 * advisory lock. Drizzle never sees a connection. See `infrastructure/db/query.ts`
 * for why that is.
 *
 * ## Every write here is monotone, which is why none of them takes a lock
 *
 * `tag-repository.ts` has a `BookTransactions` port beside it because restating
 * a source's tags is a read, a decision and a write, and two of them racing can
 * each decide what the other is about to delete. Nothing here reads before it
 * writes. A crop arrives, a hash arrives, `examined` goes from false to true,
 * and no statement in this file can take any of the three back, so two callers
 * racing agree whatever order they land in.
 *
 * That is not a nicety. Two crop passes over one book overlap routinely: one is
 * fired after a save and the other is the backfill loop. In stage G they read
 * `cropped = ''`, one wrote `'front'` and the other wrote `'edge'` over it, and
 * the "looked at and declined" state, which is the entire reason the column
 * exists, was erased for a slot whose crop column stayed populated. `Store.setCrop`
 * fixed that by adding to the list in SQL. This table gets it for free, because
 * the fact lives on the photograph it is about rather than in a list shared by
 * three of them.
 */

import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { CaptureRepository, NewPhotograph } from '../../application/capture/ports'
import {
  Photographs, isPhotographKind, type Photograph,
} from '../../domain/capture/photographs'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { capture } from '../db/schema'

/** A row as the driver hands it back: column names, not domain names. */
interface CaptureRow {
  kind: string
  file: string
  crop_file: string
  examined: boolean
  hash: string
  taken_at: string
}

/** The same row when several books' photographs arrive in one answer. */
interface OwnedCaptureRow extends CaptureRow {
  book_id: number
}

/**
 * A row as a photograph.
 *
 * The kind is checked rather than cast. `kind` is a text column with no check
 * constraint, so a value nothing in this codebase writes could be in it, and a
 * blind cast would hand the domain a `PhotographKind` that is not one and lose
 * the photograph somewhere far away from here.
 */
function toPhotograph(row: CaptureRow): Photograph {
  if (!isPhotographKind(row.kind)) {
    throw new Error(`the photograph ${row.file} is recorded as a "${row.kind}", which is not a kind`)
  }
  return {
    kind: row.kind,
    file: row.file,
    cropFile: row.crop_file,
    examined: row.examined,
    hash: row.hash,
    takenAt: row.taken_at,
  }
}

const column = (name: string) => sql.identifier(name)

export class DrizzleCaptureRepository implements CaptureRepository {
  constructor(private readonly db: Db) {}

  async of(bookId: number): Promise<Photographs> {
    const query = statement(
      build.select({
        kind: capture.kind,
        cropFile: capture.cropFile,
        examined: capture.examined,
        hash: capture.hash,
        takenAt: capture.takenAt,
        file: capture.file,
      }).from(capture)
        // By id, so photographs taken in one session, which share a timestamp,
        // come back in the order they were taken. `Photographs.of` sorts newest
        // first with a stable sort, so this is the tiebreak it inherits.
        .where(eq(capture.bookId, bookId))
        .orderBy(asc(capture.id)),
    )
    const rows = await this.db.all<CaptureRow>(query.text, query.values)
    return Photographs.of(rows.map(toPhotograph))
  }

  /**
   * Many books' photographs in one statement, ordered exactly as `of` orders
   * one book's.
   *
   * The ordering matters and is not incidental: `Photographs.of` sorts newest
   * first with a stable sort, so the tiebreak between two photographs taken in
   * the same second is the order the rows arrive in. Reading them by id here is
   * what makes the answer for a book identical whether it was asked for on its
   * own or alongside a hundred others.
   */
  async ofMany(bookIds: readonly number[]): Promise<Map<number, Photographs>> {
    const found = new Map<number, Photographs>()
    // Not a query with an empty list in it. `IN ()` is a syntax error in some
    // dialects and an always-false predicate in others, and neither is worth
    // finding out about from a shelf with no books on it.
    if (!bookIds.length) return found

    const query = statement(
      build.select({
        bookId: capture.bookId,
        kind: capture.kind,
        cropFile: capture.cropFile,
        examined: capture.examined,
        hash: capture.hash,
        takenAt: capture.takenAt,
        file: capture.file,
      }).from(capture)
        .where(inArray(capture.bookId, [...bookIds]))
        .orderBy(asc(capture.id)),
    )
    const rows = await this.db.all<OwnedCaptureRow>(query.text, query.values)

    const byBook = new Map<number, Photograph[]>()
    for (const row of rows) {
      const list = byBook.get(row.book_id) ?? []
      list.push(toPhotograph(row))
      byBook.set(row.book_id, list)
    }
    for (const [bookId, list] of byBook) found.set(bookId, Photographs.of(list))
    return found
  }

  /**
   * One upsert per photograph, keyed on the book and the file.
   *
   * `kind` and `taken_at` are deliberately not in the `DO UPDATE`: a photograph
   * is of what it is of and was taken when it was taken, and a later save
   * restating the same file should not be able to move either. The three that
   * are there each only move one way, which is what makes this safe to run
   * concurrently with itself.
   */
  async record(bookId: number, photographs: readonly NewPhotograph[]): Promise<void> {
    for (const photograph of photographs) {
      const query = statement(sql`
        insert into ${capture} (
          ${column(capture.bookId.name)}, ${column(capture.kind.name)},
          ${column(capture.file.name)}, ${column(capture.cropFile.name)},
          ${column(capture.examined.name)}, ${column(capture.hash.name)},
          ${column(capture.takenAt.name)}
        ) values (
          ${bookId}, ${photograph.kind}, ${photograph.file},
          ${photograph.cropFile ?? ''}, ${photograph.examined ?? false},
          ${photograph.hash ?? ''}, ${photograph.takenAt}
        )
        on conflict (${column(capture.bookId.name)}, ${column(capture.file.name)})
        do update set
          ${column(capture.cropFile.name)} = case
            when excluded.${column(capture.cropFile.name)} <> ''
              then excluded.${column(capture.cropFile.name)}
            else ${capture}.${column(capture.cropFile.name)}
          end,
          ${column(capture.examined.name)} =
            ${capture}.${column(capture.examined.name)}
            or excluded.${column(capture.examined.name)},
          ${column(capture.hash.name)} = case
            when excluded.${column(capture.hash.name)} <> ''
              then excluded.${column(capture.hash.name)}
            else ${capture}.${column(capture.hash.name)}
          end
      `)
      await this.db.run(query.text, query.values)
    }
  }
}
