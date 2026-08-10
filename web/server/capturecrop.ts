/**
 * Giving a queued capture the same derivatives a catalogued book gets: the
 * three photographs cut down to the book, and a hash of the front.
 *
 * A capture used to be three photographs and nothing else, so the queue could
 * not show a cropped front and a book held up to the camera could not be
 * recognised as one already waiting to be shelved. Both come from the same
 * gap, which is why this is one file rather than two.
 *
 * The rules are the ones the books path already keeps, and they are kept here
 * by using its code rather than by copying its behaviour:
 *
 *   - The photograph is the record. `cropPhotos` writes new files with derived
 *     names onto the photograph's own row, and nothing anywhere in this path
 *     opens a photograph for writing.
 *   - A slot named in `cropped` with no crop beside it was looked at and
 *     declined, which is a different fact from never having been looked at.
 *   - Hashing fails closed. A frame with no detail in it is refused by
 *     `coverHash`, and a refusal leaves the stored hash exactly as it was rather
 *     than storing something that would go on to be compared. A wrong match is
 *     worse than no match.
 *
 * The reader and writer are injected rather than opened here, the same seam
 * `crop.ts` and `rehash.ts` use, so the caller decides which directory is
 * being touched and a test needs no directory at all.
 */

import {
  cropPhotos,
  type CropIo,
  type CropOptions,
  type CropSink,
  type CroppableBook,
  type SlotOutcome,
} from './crop'
import { coverHash } from './imagehash'

/** A capture with photographs in it, and somewhere to put what they yield. */
export interface DerivableCapture extends CroppableBook {
  front_hash: string
}

/** Where the outcome goes. `CaptureQueue` satisfies this. */
export interface CaptureSink extends CropSink {
  setFrontHash: (id: number, hash: string) => Promise<void>
}

/** Every capture that carries a photograph, for a backfill to work through. */
export interface CaptureSource extends CaptureSink {
  photographed: () => Promise<DerivableCapture[]>
}

/**
 * What became of the front hash.
 *
 * `refused` and `unreadable` are told apart deliberately. The first is the
 * detector doing its job on a frame with nothing in it, and re-running will
 * refuse it again; the second is a file that has gone missing, which is a
 * problem to fix rather than a fact about a photograph.
 */
export type HashOutcome = 'written' | 'kept' | 'refused' | 'unreadable' | 'absent'

export interface CaptureOutcome {
  crops: SlotOutcome[]
  hash: HashOutcome
}

/**
 * Crop a capture's photographs and hash its front.
 *
 * Idempotent on both halves: a slot already in `cropped` is skipped and a
 * front hash already stored is kept, so a second pass finds nothing to do and
 * an interrupted one leaves what it finished done. `force` re-examines both,
 * which is what to use after a change to the detector or the hash format.
 */
export async function deriveCapture(
  sink: CaptureSink,
  capture: DerivableCapture,
  io: CropIo,
  options: CropOptions = {},
): Promise<CaptureOutcome> {
  const { apply = false, force = false } = options

  const crops = await cropPhotos(sink, capture, io, { apply, force })
  const hash = await hashFront(sink, capture, io, { apply, force })

  return { crops, hash }
}

/**
 * Hash the front photograph, in the one format `imagehash.ts` writes.
 *
 * Deliberately the original and not the crop. The books path hashes the
 * photograph, a match is decided by comparing one against another, and a hash
 * of a crop compared against a hash of a whole photograph would be two
 * different framings of the same book scored as though they were comparable.
 * Same algorithm, same format tag, same input, or the comparison is not one.
 */
async function hashFront(
  sink: CaptureSink,
  capture: DerivableCapture,
  io: CropIo,
  options: { apply: boolean; force: boolean },
): Promise<HashOutcome> {
  if (!capture.front_image) return 'absent'
  if (capture.front_hash && !options.force) return 'kept'

  let source: Buffer
  try {
    source = Buffer.from(await io.read(capture.front_image))
  } catch {
    // A photograph that has gone missing leaves whatever hash was there. A
    // stale hash is useless, but blanking it would throw away the evidence
    // that this capture was ever hashed, exactly as `rehash` argues.
    return 'unreadable'
  }

  let hash: string
  try {
    hash = await coverHash(source)
  } catch {
    // No detail in the frame, or bytes that are not an image. Either way
    // there is nothing honest to store, and something dishonest here would be
    // offered to somebody as the book in their hands.
    return 'refused'
  }

  if (hash === capture.front_hash) return 'kept'
  if (options.apply) await sink.setFrontHash(capture.id, hash)
  return 'written'
}

export interface CaptureFailure {
  id: number
  image: string
  reason: string
}

export interface CaptureReport {
  /** Captures examined. */
  rows: number
  /** Photographs the detector was shown. */
  images: number
  /** Photographs a book was found in. */
  cropped: number
  /** Photographs the detector declined, which stay whole. */
  declined: number
  /** Photographs left alone because they had been looked at already. */
  skipped: number
  /** Fronts hashed. */
  hashed: number
  /** Fronts left alone because they already carry a current hash. */
  hashKept: number
  /** Fronts with no detail to hash, which are left unhashed rather than guessed. */
  hashRefused: number
  /** Files that could not be read. One entry in `failures` each. */
  failed: number
  failures: CaptureFailure[]
}

export interface BackfillOptions extends CropOptions {
  read: CropIo['read']
  write: CropIo['write']
  /** Called once per photograph with a line worth showing an operator. */
  onNote?: (line: string) => void
  /** Stop after this many captures. Absent means the whole queue. */
  limit?: number
}

/**
 * Work through the captures already in the queue.
 *
 * New captures are derived by the worker as their photographs arrive, so this
 * exists for the ones photographed before any of that. Nothing calls it on a
 * timer and no route triggers it: `crop-captures.ts` is the front end, and
 * like the two backfills before it, it is a dry run unless told otherwise.
 */
export async function backfillCaptures(
  source: CaptureSource,
  options: BackfillOptions,
): Promise<CaptureReport> {
  const { apply = false, force = false, read, write, onNote, limit } = options
  const note = onNote ?? (() => {})

  const report: CaptureReport = {
    rows: 0, images: 0, cropped: 0, declined: 0, skipped: 0,
    hashed: 0, hashKept: 0, hashRefused: 0, failed: 0, failures: [],
  }

  for (const row of await source.photographed()) {
    if (limit !== undefined && report.rows >= limit) break
    report.rows += 1

    const examined = new Set(row.cropped.split(',').filter(Boolean))
    for (const slot of ['front', 'back', 'edge'] as const) {
      if (!row[`${slot}_image` as const]) continue
      if (!force && examined.has(slot)) report.skipped += 1
    }

    const outcome = await deriveCapture(source, { ...row }, { read, write }, { apply, force })

    for (const slot of outcome.crops) {
      report.images += 1
      if (slot.refusal === 'unreadable') {
        report.failed += 1
        report.failures.push({
          id: row.id,
          image: slot.image,
          reason: 'could not be read',
        })
        continue
      }
      if (slot.crop) {
        report.cropped += 1
        note(`capture ${row.id} ${slot.slot}: ${slot.image} -> ${slot.crop}`)
      } else {
        report.declined += 1
        note(`capture ${row.id} ${slot.slot}: no book found (${slot.refusal ?? 'declined'}), kept whole`)
      }
    }

    if (outcome.hash === 'written') {
      report.hashed += 1
      note(`capture ${row.id} front: hashed ${row.front_image}`)
    } else if (outcome.hash === 'kept') {
      report.hashKept += 1
    } else if (outcome.hash === 'refused') {
      report.hashRefused += 1
      note(`capture ${row.id} front: no detail to hash, left unhashed`)
    } else if (outcome.hash === 'unreadable') {
      report.failed += 1
      report.failures.push({
        id: row.id,
        image: row.front_image,
        reason: 'could not be read for hashing',
      })
    }
  }

  return report
}
