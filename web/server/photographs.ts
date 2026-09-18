/**
 * Photographs, on the way in and on the way out.
 *
 * `capture` is the record: no statement anywhere reads a photograph from `books`,
 * and every write of a photograph in this repository goes through a function in
 * this file.
 *
 * `PhotographFields` below keeps the field names the dropped columns had, because
 * the client, the browser suite and the two crop backfills still read
 * `front_image`, `front_crop` and `cropped`. `cropped` is rebuilt here from
 * `examined` rather than stored: a slot named in it with an empty crop is "looked
 * at and declined", and a slot not named at all has never been looked at.
 */

import { RecordPhotographsHandler } from '../application/capture/record-photographs'
import type { NewPhotograph } from '../application/capture/ports'
import {
  type Photograph, type PhotographKind, Photographs,
} from '../domain/capture/photographs'
import { DrizzleCaptureRepository } from '../infrastructure/capture/capture-repository'
import type { BookRow, FiledBookRow } from './db.pg'
import type { Db } from './driver'

/**
 * The slot names the wire, the client and the crop detector use, and the kinds
 * `capture` records them under. `edge` is what the client and the detector call
 * the spine, and `spine` is what `docs/data-model.md` settles on.
 */
export const KIND_OF_SLOT = { front: 'front', back: 'back', edge: 'spine' } as const

/** The three photographs somebody takes of a book. Not the catalogue artwork. */
export type PhotoSlot = keyof typeof KIND_OF_SLOT

export const PHOTO_SLOTS: readonly PhotoSlot[] = ['front', 'back', 'edge']

/**
 * A book's photographs, flattened to the one-per-slot shape the wire and the
 * backfills still ask for. Every field is derived from `capture` and none of them
 * is a column: a book with four spine photographs has one `edge_image` here, the
 * newest, and the other three are still rows, reachable through
 * `GET /api/books/:id/captures`.
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
  /** Slots a detector has been shown, comma separated. */
  cropped: string
  front_hash: string
  cover_hash: string
}

export type PhotographedBook = BookRow & PhotographFields

/**
 * The same, for a book read out of one of the three views rather than out of
 * `books`: the view joins on the name a book files under, its first credit's
 * alias. `Store.getBook` answers a `PhotographedBook`, and everything that draws
 * a shelf answers this.
 */
export type FiledPhotographedBook = FiledBookRow & PhotographFields

/** A book nobody has photographed, which is a real state and not an error. */
export const NO_PHOTOGRAPHS: PhotographFields = {
  front_image: '', back_image: '', edge_image: '', cover_image: '',
  front_crop: '', back_crop: '', edge_crop: '', cropped: '',
  front_hash: '', cover_hash: '',
}

/**
 * The current photograph of each kind, as the fields everything above still
 * reads. The catalogue artwork is never examined and carries no crop, so it
 * contributes a file and a hash and nothing else.
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
    // whatever the flag says.
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

/** Built per call. It holds nothing but the `Db` it is handed, so there is nothing to reuse. */
function repository(db: Db) {
  return new DrizzleCaptureRepository(db)
}

/** One book's photographs, newest first within each kind. */
export function photographsOf(db: Db, bookId: number): Promise<Photographs> {
  return repository(db).of(bookId)
}

/**
 * Give each row the photographs of the book it is, in one statement.
 *
 * A book with no photographs gets the empty answer rather than being dropped,
 * because "this book has no picture" is a thing a shelf has to draw. One
 * statement for the whole list, because the library listing is every catalogued
 * book and asking per book would be a statement per row.
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
 * Every photograph, not the current one of each kind, because a spine re-shot
 * twice is three files on disk. Nothing here touches a file: it answers names,
 * and the caller decides, through the orphan check that stops a delete taking a
 * photograph another book still names.
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

/**
 * Write down what is known about a book's photographs.
 *
 * Every field `record` writes moves in one direction only, so calling it twice
 * about the same photograph means the same as calling it once. A photograph whose
 * file has changed since the last call is a new photograph and gets a new row.
 */
export async function recordPhotographs(
  db: Db,
  bookId: number,
  photographs: readonly NewPhotograph[],
): Promise<void> {
  await new RecordPhotographsHandler(repository(db)).handle({ bookId, photographs })
}

/**
 * Somebody took a photograph of this book, in this slot, now. Re-taking a slot
 * writes a second row rather than overwriting the first: the original is the
 * record.
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
 * The catalogue handed over its artwork for this book. A file is a photograph and
 * an empty answer is not, so a book nobody has artwork for records nothing here;
 * that it was looked for is `books.cover_checked_at`, which is what stops the
 * backfill asking again forever.
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
 * frame. Either way `examined` goes true, because "looked at and found nothing"
 * and "never looked at" are different states and only the first one licenses a
 * caption to say the book could not be picked out. The photograph's own file is
 * not touched, here or anywhere: the original is the record.
 *
 * Nothing to record for a slot with no photograph in it, which is a crop pass
 * racing a delete.
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
 * An empty hash is not a hash and writes nothing: `record` only takes a value
 * that says something, so a read that failed leaves whatever was there rather
 * than blanking it.
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

export async function recordFrontHash(
  db: Db,
  bookId: number,
  hash: string,
): Promise<void> {
  await recordHashes(db, bookId, hash, '')
}
