/**
 * Storing crops of a book's photographs beside the photographs.
 *
 * `bookcrop.ts` decides where the book is. This decides what happens to the
 * answer, and it has exactly one rule that matters: **the original is never
 * written to.** A crop is a new file with a derived name, recorded in its own
 * column, and every path through this file either adds one or records that it
 * could not. There is no branch here that opens a photograph for writing.
 *
 * The reader and writer are injected rather than opened here, so the caller
 * decides which directory is being touched and a test needs no directory at
 * all. That is the same seam `rehash.ts` uses, for the same reason.
 */

import { cropBook, type CropRefusal } from './bookcrop'
import type { Store } from './store'

export const CROP_SLOTS = ['front', 'back', 'edge'] as const
export type CropSlot = (typeof CROP_SLOTS)[number]

export interface CropIo {
  read: (name: string) => Buffer | Promise<Buffer>
  write: (name: string, data: Buffer) => void | Promise<void>
}

/**
 * Where the outcome of looking at one photograph gets written.
 *
 * `Store` satisfies this for books and `CaptureQueue` for captures, and each
 * owns its own table's SQL as it did before. The interface exists so the two
 * share the detector, the file naming and the "a slot named in `cropped` with
 * an empty crop column was looked at and declined" contract rather than each
 * carrying a copy of it that could drift.
 */
export interface CropSink {
  setCrop: (id: number, slot: CropSlot, name: string) => Promise<void>
}

/**
 * What to call the crop of a photograph.
 *
 * Derived from the original's name so the two sit next to each other in a
 * directory listing and it is obvious at a glance which came from which. The
 * suffix cannot collide with a photograph: `saveImage` ends every name it
 * writes with a slot, and `downloadCover` with `_cover`.
 */
export function cropName(original: string): string {
  return `${original.replace(/\.[a-z0-9]+$/i, '')}_crop.jpg`
}

/** A photograph the detector has been shown, and what it made of it. */
export interface SlotOutcome {
  slot: CropSlot
  /** The photograph. */
  image: string
  /** The crop, or '' when the book could not be found. */
  crop: string
  /** Why there is no crop. Undefined when there is one. */
  refusal?: CropRefusal | 'unreadable'
}

export interface CropOptions {
  /** Write the crops and the rows. Without it nothing is written at all. */
  apply?: boolean
  /** Look again at slots already examined, instead of skipping them. */
  force?: boolean
}

/**
 * A row with photographs in it. A book or a queued capture: both carry the
 * same three slots, the same three crop columns and the same `cropped` list,
 * so both are croppable on exactly the same terms.
 */
export interface CroppableBook {
  id: number
  front_image: string
  back_image: string
  edge_image: string
  front_crop: string
  back_crop: string
  edge_crop: string
  cropped: string
}

/**
 * Crop whichever of a row's photographs have not been looked at yet.
 *
 * Idempotent: a slot already in `cropped` is skipped, so a second run finds
 * nothing to do and an interrupted run leaves the slots it finished done. A
 * photograph that cannot be read is reported and skipped, never blanked, for
 * the same reason `rehash` leaves a stale hash alone rather than clearing it.
 */
export async function cropPhotos(
  sink: CropSink,
  book: CroppableBook,
  io: CropIo,
  options: CropOptions = {},
): Promise<SlotOutcome[]> {
  const { apply = false, force = false } = options
  const examined = new Set(book.cropped.split(',').filter(Boolean))
  const outcomes: SlotOutcome[] = []

  for (const slot of CROP_SLOTS) {
    const image = book[`${slot}_image` as const]
    if (!image) continue
    if (!force && examined.has(slot)) continue

    let source: Buffer
    try {
      source = Buffer.from(await io.read(image))
    } catch {
      // A photo that has gone missing must not cost us the slots after it,
      // and it must not be recorded as "looked at and no book found" either,
      // because that is a statement about a photograph nobody has seen.
      outcomes.push({ slot, image, crop: '', refusal: 'unreadable' })
      continue
    }

    const result = await cropBook(source)

    if (!result.image) {
      outcomes.push({ slot, image, crop: '', refusal: result.refusal })
      if (apply) await sink.setCrop(book.id, slot, '')
      continue
    }

    const name = cropName(image)
    if (apply) {
      await io.write(name, result.image)
      await sink.setCrop(book.id, slot, name)
    }
    outcomes.push({ slot, image, crop: name })
  }

  return outcomes
}

export interface CropFailure {
  id: number
  title: string
  image: string
  reason: string
}

export interface CropReport {
  /** Book rows examined. */
  rows: number
  /** Photographs the detector was shown. */
  images: number
  /** Photographs a book was found in. */
  cropped: number
  /** Photographs the detector declined, which stay whole. */
  declined: number
  /** Photographs left alone because they had been looked at already. */
  skipped: number
  /** Photographs that could not be read. One entry in `failures` each. */
  failed: number
  failures: CropFailure[]
}

export interface CropAllOptions extends CropOptions {
  read: CropIo['read']
  write: CropIo['write']
  /** Called once per photograph with a line worth showing an operator. */
  onNote?: (line: string) => void
  /** Stop after this many photographs. Absent means the whole catalogue. */
  limit?: number
}

/**
 * Crop every photograph in the catalogue that has not been looked at.
 *
 * Nothing calls this on a timer and no route triggers it. There are hundreds
 * of photographs of somebody's real collection behind this, the cost of
 * re-reading them all is his to spend, and a derived file appearing beside
 * every photograph he owns is his decision to make. `crop-books.ts` is the
 * front end, and like the rehash before it, it is a dry run unless told
 * otherwise.
 */
export async function cropCatalogue(
  store: Store,
  options: CropAllOptions,
): Promise<CropReport> {
  const { apply = false, force = false, read, write, onNote, limit } = options
  const note = onNote ?? (() => {})

  const report: CropReport = {
    rows: 0, images: 0, cropped: 0, declined: 0, skipped: 0, failed: 0, failures: [],
  }

  for (const row of await store.photographed()) {
    if (limit !== undefined && report.images >= limit) break
    report.rows += 1

    const examined = new Set(row.cropped.split(',').filter(Boolean))
    for (const slot of CROP_SLOTS) {
      if (!row[`${slot}_image` as const]) continue
      if (!force && examined.has(slot)) report.skipped += 1
    }

    const outcomes = await cropPhotos(store, { ...row }, { read, write }, { apply, force })
    for (const outcome of outcomes) {
      report.images += 1
      if (outcome.refusal === 'unreadable') {
        report.failed += 1
        report.failures.push({
          id: row.id,
          title: row.title,
          image: outcome.image,
          reason: 'could not be read',
        })
        continue
      }
      if (outcome.crop) {
        report.cropped += 1
        note(`book ${row.id} ${outcome.slot}: ${outcome.image} -> ${outcome.crop}`)
      } else {
        report.declined += 1
        note(`book ${row.id} ${outcome.slot}: no book found (${outcome.refusal ?? 'declined'}), kept whole`)
      }
    }
  }

  return report
}
