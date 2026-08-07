/**
 * The eight image columns on `books`, read as photographs.
 *
 * This is the bridge #181 leaves behind, and it is deliberately the smallest
 * thing that could be one. `capture` is the model; `books.front_image` and the
 * seven columns beside it are still what `Store`, the crop backfill, the
 * gallery, the queue panel and the shelf row read, and cutting all of that over
 * is the work that remodels `books` and touches most of the client. Until then
 * every save writes both, exactly as #179 left `books.is_fiction` writing
 * alongside the tag tables, and this function is the one place that says how the
 * columns translate.
 *
 * It lives in `server/` because that is the layer the columns belong to. The
 * application layer is handed photographs and never learns that there was ever
 * a column called `edge_image`, which is the whole of the separation and is what
 * makes deleting this file the last step of the cut-over rather than the first.
 *
 * **It is the same derivation `0004_photographs_become_capture_rows.sql`
 * performs, said in TypeScript.** They have to agree, because the migration
 * writes the rows for every book that existed and this writes them for every
 * book saved afterwards, and `capture-backfill.test.ts` and
 * `captures.routes.test.ts` each assert one half against the same table of
 * expectations.
 */

import type { NewPhotograph } from '../application/capture/ports'
import type { BookRow } from './db.pg'

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
