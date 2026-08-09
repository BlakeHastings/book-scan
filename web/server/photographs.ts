/**
 * The eight image columns on `books`: what they say, and who says it.
 *
 * This is the bridge #181 leaves behind, and it is deliberately the smallest
 * thing that could be one. `capture` is the model; `books.front_image` and the
 * seven columns beside it are still what `Store`, the crop backfill, the
 * gallery, the queue panel and the shelf row read, and cutting all of that over
 * is the work that remodels `books` and touches most of the client. Until then
 * both are written, exactly as #179 left `books.is_fiction` writing alongside
 * the tag tables, and this file is the one place that says how the columns
 * translate.
 *
 * It lives in `server/` because that is the layer the columns belong to. The
 * application layer is handed photographs and never learns that there was ever
 * a column called `edge_image`, which is the whole of the separation and is what
 * makes deleting this file the last step of the cut-over rather than the first.
 *
 * **It is the same derivation `0006_photographs_become_capture_rows.sql`
 * performs, said in TypeScript.** They have to agree, because the migration
 * writes the rows for every book that existed and this writes them for every
 * book photographed afterwards, and `capture-backfill.test.ts` and
 * `captures.routes.test.ts` each assert one half against the same table of
 * expectations.
 *
 * ## Why "a photograph changed" is owned here rather than at each caller
 *
 * #192 left the rows being written from the two save routes and the chain
 * behind one of them, and five other paths wrote the columns without them: the
 * cover backfill, the hash backfill, `POST /api/backfill/covers`, and the
 * `crop-books` and `rehash-covers` command line tools. Nothing read `capture`,
 * so the drift had no symptom, and `record` is idempotent, so it closed itself
 * the next time anybody saved that book. It would have had a symptom on the day
 * of the cut-over, a week after the background job that caused it.
 *
 * Five callers each remembering to do a second thing is the shape that produced
 * that, and a sixth is as easy to forget as the first five were. So the
 * recording moved to `recordPhotographsOf` below and to the statements that
 * write the columns: `Store.setCoverImage`, `Store.setHashes` and `recordCrop`
 * each hand back the row they just wrote and record it. A caller cannot forget
 * something it never had to remember, and the command line tools, which are not
 * the server and go through none of its wiring, get it because they go through
 * the same three statements.
 */

import { RecordPhotographsHandler } from '../application/capture/record-photographs'
import type { NewPhotograph } from '../application/capture/ports'
import { DrizzleCaptureRepository } from '../infrastructure/capture/capture-repository'
import type { BookRow } from './db.pg'
import type { Db } from './driver'

/** When a photograph with no timestamp anywhere is dated from. */
const UNDATED = '1970-01-01T00:00:00.000Z'

/**
 * Which slot names `books.cropped` uses for each kind.
 *
 * `edge` is what the columns, the client and the crop detector have called the
 * spine since before any of this, and `spine` is what `docs/data-model.md`
 * settles on. This map and the migration are the only two places the two
 * spellings meet.
 */
const SLOT_OF_KIND = { front: 'front', back: 'back', spine: 'edge' } as const

/** Has the detector been shown this slot, whether or not it found anything? */
function examined(cropped: string, slot: 'front' | 'back' | 'edge'): boolean {
  return cropped.split(',').filter(Boolean).includes(slot)
}

/**
 * The photographs a book row names.
 *
 * Empty columns are left out rather than becoming photographs with no file:
 * `RecordPhotographsHandler` drops them anyway, and answering them here would
 * make this function's result a worse description of the book than the row it
 * came from.
 *
 * `taken_at` is the row's own timestamp rather than the moment this runs, for
 * the reason the migration gives: a photograph was taken when it was taken, and
 * dating one from the save that mentioned it would be a worse answer than the
 * one already recorded.
 */
export function photographsOf(book: BookRow): NewPhotograph[] {
  const cropped = book.cropped ?? ''
  const scannedAt = book.scanned_at || UNDATED

  const photographs: NewPhotograph[] = []

  for (const [kind, image, crop, hash] of [
    ['front', book.front_image, book.front_crop, book.front_hash],
    ['back', book.back_image, book.back_crop, ''],
    ['spine', book.edge_image, book.edge_crop, ''],
  ] as const) {
    if (!image) continue
    photographs.push({
      kind,
      file: image,
      cropFile: crop ?? '',
      examined: examined(cropped, SLOT_OF_KIND[kind]),
      hash: hash ?? '',
      takenAt: scannedAt,
    })
  }

  if (book.cover_image) {
    photographs.push({
      kind: 'catalogue',
      file: book.cover_image,
      cropFile: '',
      // The detector finds a book in a room. A publisher's artwork has no room
      // in it and has never been offered one.
      examined: false,
      hash: book.cover_hash ?? '',
      takenAt: book.cover_checked_at || scannedAt,
    })
  }

  return photographs
}

/**
 * Write down the photographs a book row now names.
 *
 * Takes the row rather than an id on purpose: every caller has just written it,
 * and re-reading it would make this describe a book as it is a moment later
 * rather than as the statement left it.
 *
 * Costs one statement per photograph and can lose nothing, because every field
 * `record` writes moves in one direction only. Calling it twice about the same
 * row means the same as calling it once. See `CaptureRepository.record`.
 *
 * A photograph whose file has changed since the last call is a **new photograph
 * and gets a new row**, which is the whole point of the table: a blurred spine
 * re-shot today keeps the blurred one.
 *
 * The repository is built here rather than injected. It holds nothing but the
 * `Db` it is handed, so building one costs an object, and a seam here would be
 * a constructor argument on `Store`, on `CaptureQueue` and at every place
 * either is built, including the two command line tools. That is the wiring
 * this is meant to remove, not add.
 */
export async function recordPhotographsOf(db: Db, book: BookRow): Promise<void> {
  await new RecordPhotographsHandler(new DrizzleCaptureRepository(db)).handle({
    bookId: book.id,
    photographs: photographsOf(book),
  })
}

/**
 * Record what the detector made of one photograph, on the column and the row.
 *
 * `Store.setCrop` and `CaptureQueue.setCrop` were the same statement against two
 * tables, and #183 made them the same statement against one. Both call this, so
 * there is one copy of it: two identical copies is how the next fix gets made in
 * only one of them.
 *
 * `name` is the derived file, or '' when the book could not be found in the
 * frame. Either way the slot joins `cropped`, because "looked at and found
 * nothing" and "never looked at" are different states and only the first is
 * worth telling a reader about. The photograph's row carries the same
 * distinction as `examined` with an empty `crop_file`, which is what
 * `photographsOf` above derives from `cropped` and is the reason this records
 * from the row the statement returned rather than from `name`.
 *
 * The photograph's own column is not touched, here or anywhere: the original is
 * the record.
 *
 * **`cropped` is added to in SQL rather than read out, edited and written
 * back**, which is the fix for a lost update stage G found. Two crop passes on
 * one book overlap routinely, one fired after a save and one from the backfill
 * loop. Both read `cropped = ''`, one wrote `'front'` and the other wrote
 * `'edge'` over it, so a slot stayed cropped with nothing saying it had been
 * looked at, and the "looked at and declined" state this column exists for was
 * erased. One statement has nothing to interleave with.
 */
export async function recordCrop(
  db: Db,
  id: number,
  slot: 'front' | 'back' | 'edge',
  name: string,
): Promise<void> {
  // The slot is a union of three literals, not user input, so the two places it
  // is interpolated cannot carry anything but a column name this file wrote.
  // Everything else is a parameter.
  const row = await db.get<BookRow>(
    `UPDATE books SET
       ${slot}_crop = ?,
       cropped = CASE
         WHEN ',' || COALESCE(cropped, '') || ',' LIKE ? THEN cropped
         WHEN COALESCE(cropped, '') = ''                 THEN ?
         ELSE cropped || ',' || ?
       END
     WHERE id = ?
     RETURNING *`,
    [name, `%,${slot},%`, slot, slot, id],
  )

  // No row means no such book, which the crop passes reach by racing a delete.
  // There is nothing to record about a book that has gone.
  if (row) await recordPhotographsOf(db, row)
}
