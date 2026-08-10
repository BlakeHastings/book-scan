/**
 * Photographs, on the way in and on the way out.
 *
 * **`capture` is the record now (#228).** `books.front_image` and the nine
 * columns beside it are gone: dropped, not deprecated, so there is no second
 * answer to what a book has been photographed with and nothing left to keep in
 * step. Every write of a photograph in this repository goes through a function
 * in this file, and every reader is handed the answer this file derives.
 *
 * It lives in `server/` because that is the layer the flattening belongs to.
 * The application layer is handed photographs and the domain owns what "the
 * current spine" means (`Photographs.latest`); what this file adds is the
 * projection the wire and the two backfills still speak in, and the four write
 * paths that turn a filename into a row.
 *
 * ## The flat shape is the wire's, not the schema's
 *
 * `PhotographFields` below has the same field names the dropped columns had.
 * That is deliberate and it is temporary. The client, the browser suite and the
 * two crop backfills all read `front_image`, `front_crop` and `cropped`, and
 * changing the shape of every book on the wire in the same change that drops ten
 * columns and moves every writer is not a change anybody can review as one
 * thing. #223 made the same call about `books.is_fiction`: cut the decision
 * over, take the field off the wire afterwards. What matters is that no
 * statement anywhere reads a photograph from `books`, and none does.
 *
 * `cropped` is rebuilt here from `examined` rather than stored, which is the
 * one place the two halves of the distinction meet:
 *
 * | `examined` | `crop_file` | in `cropped` | What a caption may say |
 * | --- | --- | --- | --- |
 * | false | `''` | no | Nothing. No detector has opened it. |
 * | true | `''` | yes | It looked and could not find the book. |
 * | true | a file | yes | It found the book, and here it is. |
 *
 * A slot named in `cropped` with an empty crop is "looked at and declined", and
 * a slot not named at all has never been looked at. That was one string per row
 * describing three photographs; it is now a fact per photograph, derived back
 * into the string at the edge and nowhere else.
 *
 * ## Why the writes are here rather than at each caller
 *
 * #192 left the rows being written from the two save routes and the chain behind
 * one of them, and five other paths wrote the columns without them: the cover
 * backfill, the hash backfill, `POST /api/backfill/covers`, and the `crop-books`
 * and `rehash-covers` command line tools. Nothing read `capture`, so the drift
 * had no symptom. It would have had one on the day of the cut-over, a week after
 * the background job that caused it, which is why #214 moved the recording onto
 * the statements rather than the callers and why the repair for the rows written
 * in between is part of this change (`0017`).
 *
 * Five callers each remembering to do a second thing is the shape that produced
 * that, and a sixth is as easy to forget as the first five were. There is no
 * second thing to remember any more: these functions are the only way a
 * photograph is written down at all.
 */

import { RecordPhotographsHandler } from '../application/capture/record-photographs'
import type { NewPhotograph } from '../application/capture/ports'
import {
  type Photograph, type PhotographKind, Photographs,
} from '../domain/capture/photographs'
import { DrizzleCaptureRepository } from '../infrastructure/capture/capture-repository'
import type { BookRow } from './db.pg'
import type { Db } from './driver'

/**
 * The slot names the wire, the client and the crop detector use, and the kinds
 * `capture` records them under.
 *
 * `edge` is what the columns, the client and the detector have called the spine
 * since before any of this, and `spine` is what `docs/data-model.md` settles on.
 * This map, `0006` and `0017` are the only places the two spellings meet.
 */
export const KIND_OF_SLOT = { front: 'front', back: 'back', edge: 'spine' } as const

/** The three photographs somebody takes of a book. Not the catalogue artwork. */
export type PhotoSlot = keyof typeof KIND_OF_SLOT

export const PHOTO_SLOTS: readonly PhotoSlot[] = ['front', 'back', 'edge']

/**
 * A book's photographs, flattened to the one-per-slot shape the wire and the
 * backfills still ask for.
 *
 * Every field is derived from `capture` and none of them is a column. A book
 * with four spine photographs has one `edge_image` here, the newest, exactly as
 * `Photographs.latest` answers it; the other three are still rows and are still
 * reachable through `GET /api/books/:id/captures`, which is the whole point of
 * the table.
 */
export interface PhotographFields {
  front_image: string
  back_image: string
  edge_image: string
  /** The publisher's artwork. Not a photograph of this copy. */
  cover_image: string
  front_crop: string
  back_crop: string
  edge_crop: string
  /** Slots a detector has been shown, comma separated. Derived from `examined`. */
  cropped: string
  front_hash: string
  cover_hash: string
}

/**
 * A book as everything above the stores reads one: the row, plus the current
 * photograph of each kind.
 *
 * The photographs are joined on rather than stored, and the difference shows in
 * exactly one place: a book with four spine photographs has one `edge_image`
 * here, the newest, and the other three are still rows.
 * `GET /api/books/:id/captures` is what answers for those, and it is the reason
 * the columns had to go.
 */
export type PhotographedBook = BookRow & PhotographFields

/** A book nobody has photographed, which is a real state and not an error. */
export const NO_PHOTOGRAPHS: PhotographFields = {
  front_image: '', back_image: '', edge_image: '', cover_image: '',
  front_crop: '', back_crop: '', edge_crop: '', cropped: '',
  front_hash: '', cover_hash: '',
}

/**
 * The current photograph of each kind, as the fields everything above still
 * reads.
 *
 * The catalogue artwork is never examined and carries no crop: the detector
 * finds a book in a room, a publisher's picture has no room in it, and it has
 * never been offered one. So it contributes a file and a hash and nothing else.
 */
export function fieldsOf(photographs: Photographs): PhotographFields {
  const fields: PhotographFields = { ...NO_PHOTOGRAPHS }
  const examined: PhotoSlot[] = []

  for (const slot of PHOTO_SLOTS) {
    const current = photographs.latest(KIND_OF_SLOT[slot])
    if (!current) continue
    fields[`${slot}_image`] = current.file
    fields[`${slot}_crop`] = current.cropFile
    // A crop that exists is evidence the detector was shown the photograph,
    // whatever the flag says. `verdictOf` makes the same judgement for the same
    // reason: the file is evidence and the flag is bookkeeping.
    if (current.examined || current.cropFile) examined.push(slot)
  }

  const catalogue = photographs.latest('catalogue')
  if (catalogue) {
    fields.cover_image = catalogue.file
    fields.cover_hash = catalogue.hash
  }

  const front = photographs.latest('front')
  if (front) fields.front_hash = front.hash

  fields.cropped = examined.join(',')
  return fields
}

/** Built per call. It holds nothing but the handle it is given. See below. */
function repository(db: Db) {
  /*
   * The repository is built here rather than injected. It holds nothing but the
   * `Db` it is handed, so building one costs an object, and a seam here would be
   * a constructor argument on `Store`, on `Shelves`, on `CaptureQueue` and at
   * every place any of them is built, including the two command line tools. That
   * is the wiring this file exists to remove, not to add.
   */
  return new DrizzleCaptureRepository(db)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** One book's photographs, newest first within each kind. */
export function photographsOf(db: Db, bookId: number): Promise<Photographs> {
  return repository(db).of(bookId)
}

/**
 * Give each row the photographs of the book it is, in one statement.
 *
 * The `id` is the book's, which is the whole of what this needs from the row:
 * a shelved book, a queued one and a hash index entry are all a book here. A
 * book with no photographs gets the empty answer rather than being dropped,
 * because "this book has no picture" is a thing a shelf has to draw.
 *
 * **One statement for the whole list, and that is not an optimisation.** The
 * library listing is every catalogued book, a shelf group is a hundred of them,
 * and each one is drawn with the photograph it is recognised by. Asking per book
 * would turn opening the library into a statement per row.
 */
export async function withPhotographs<Row extends { id: number }>(
  db: Db,
  rows: readonly Row[],
): Promise<(Row & PhotographFields)[]> {
  const found = await repository(db).ofMany(rows.map((row) => row.id))
  return rows.map((row) => {
    const photographs = found.get(row.id)
    return { ...row, ...(photographs ? fieldsOf(photographs) : NO_PHOTOGRAPHS) }
  })
}

/**
 * Every file this book's photographs name, including the crops cut from them.
 *
 * For the two routes that delete: a book removed from the catalogue and a scan
 * somebody says was a mistake. **Every photograph, not the current one of each
 * kind**, because a spine re-shot twice is three files on disk and the rows that
 * name them go with the book. The old columns could hold one of each, so a
 * sweep that asked the flat shape would leave the ones they had overwritten
 * behind, unreferenced and unattributable.
 *
 * Nothing here touches a file. It answers names, and the caller decides, through
 * the orphan check that stops a delete taking a photograph another book still
 * names.
 */
export async function filesOf(db: Db, bookId: number): Promise<string[]> {
  const photographs = await photographsOf(db, bookId)
  return photographs.list
    .flatMap((one) => [one.file, one.cropFile])
    .filter(Boolean)
}

/** The same for a lookup that answered one row, or none. */
export async function withPhotographsOf<Row extends { id: number }>(
  db: Db,
  row: Row | undefined,
): Promise<(Row & PhotographFields) | undefined> {
  if (!row) return undefined
  return (await withPhotographs(db, [row]))[0]
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Write down what is known about a book's photographs.
 *
 * Costs one statement per photograph and can lose nothing, because every field
 * `record` writes moves in one direction only. Calling it twice about the same
 * photograph means the same as calling it once. See `CaptureRepository.record`.
 *
 * A photograph whose file has changed since the last call is a **new photograph
 * and gets a new row**, which is the whole point of the table: a blurred spine
 * re-shot today keeps the blurred one.
 */
export async function recordPhotographs(
  db: Db,
  bookId: number,
  photographs: readonly NewPhotograph[],
): Promise<void> {
  await new RecordPhotographsHandler(repository(db)).handle({ bookId, photographs })
}

/**
 * Somebody took a photograph of this book, in this slot, now.
 *
 * The one way a photograph of a copy enters the catalogue. `CaptureQueue.add`
 * and `.attach` call it as the shutter goes, and `Store.addBook` and
 * `.updateBook` call it for a save that carries files the client uploaded.
 *
 * Re-taking a slot writes a second row rather than overwriting the first, which
 * is exactly what the columns could not do: the original is the record, and the
 * app that owns somebody's photographs should not be the thing that deletes one.
 */
export async function photographTaken(
  db: Db,
  bookId: number,
  slot: PhotoSlot,
  file: string,
  takenAt: string,
): Promise<void> {
  if (!file) return
  await recordPhotographs(db, bookId, [{ kind: KIND_OF_SLOT[slot], file, takenAt }])
}

/** The three slots of a save, in one call. Empty ones are not photographs. */
export async function photographsTaken(
  db: Db,
  bookId: number,
  files: { front?: string; back?: string; edge?: string },
  takenAt: string,
): Promise<void> {
  await recordPhotographs(
    db,
    bookId,
    PHOTO_SLOTS
      .filter((slot) => files[slot])
      .map((slot) => ({ kind: KIND_OF_SLOT[slot], file: files[slot]!, takenAt })),
  )
}

/**
 * The catalogue handed over its artwork for this book.
 *
 * A file is a photograph and an empty answer is not. A book nobody has artwork
 * for records nothing here; that it was looked for is `books.cover_checked_at`,
 * which stays a column because it is a fact about the search rather than about a
 * photograph, and it is what stops the backfill asking again forever.
 */
export async function coverDownloaded(
  db: Db,
  bookId: number,
  file: string,
  at: string,
): Promise<void> {
  if (!file) return
  await recordPhotographs(db, bookId, [{ kind: 'catalogue', file, takenAt: at }])
}

/**
 * Record what the detector made of one photograph.
 *
 * `name` is the derived file, or '' when the book could not be found in the
 * frame. **Either way `examined` goes true**, because "looked at and found
 * nothing" and "never looked at" are different states and only the first one
 * licenses a caption to say the book could not be picked out. That is the
 * distinction `books.cropped` used to carry for three photographs in one string,
 * and it is now a fact about the photograph it is about.
 *
 * The photograph's own file is not touched, here or anywhere: the original is
 * the record.
 *
 * Nothing to record for a slot with no photograph in it. `cropPhotos` only ever
 * looks at a slot it has just read a file for, so the only way here is a crop
 * pass racing a delete, and there is nothing to say about a book that has gone.
 */
export async function recordCrop(
  db: Db,
  bookId: number,
  slot: PhotoSlot,
  name: string,
): Promise<void> {
  const kind = KIND_OF_SLOT[slot]
  const current = (await photographsOf(db, bookId)).latest(kind)
  if (!current) return

  await recordPhotographs(db, bookId, [{
    kind,
    file: current.file,
    cropFile: name,
    examined: true,
    takenAt: current.takenAt,
  }])
}

/**
 * Store the difference hashes of a book's front photograph and its artwork.
 *
 * A hash is a fact about one photograph, so it lands on that photograph's row
 * and there is nowhere else it could land. An empty hash is not a hash and
 * writes nothing: `record` only takes a value that says something, so a read
 * that failed leaves whatever was there rather than blanking it, which is the
 * argument `rehash.ts` makes at length.
 */
export async function recordHashes(
  db: Db,
  bookId: number,
  front: string,
  cover: string,
): Promise<void> {
  const photographs = await photographsOf(db, bookId)
  const offered: NewPhotograph[] = []

  const carry = (kind: PhotographKind, hash: string) => {
    if (!hash) return
    const current: Photograph | null = photographs.latest(kind)
    if (!current) return
    offered.push({ kind, file: current.file, hash, takenAt: current.takenAt })
  }

  carry('front', front)
  carry('catalogue', cover)

  await recordPhotographs(db, bookId, offered)
}

/** The front photograph's hash on its own, for the queue's derivation pass. */
export async function recordFrontHash(
  db: Db,
  bookId: number,
  hash: string,
): Promise<void> {
  await recordHashes(db, bookId, hash, '')
}
