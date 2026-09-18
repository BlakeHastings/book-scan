/**
 * Giving a queued capture the same derivatives a catalogued book gets: the
 * three photographs cut down to the book, and a hash of the front.
 *
 * Reuses the books path's own code rather than copying its behaviour, so
 * nothing here opens a photograph for writing; `cropPhotos` does that. A slot
 * named in `cropped` with no crop beside it was looked at and declined, which
 * differs from never having been looked at. Hashing fails closed: a frame
 * with no detail is refused by `coverHash`, and the stored hash is left
 * exactly as it was rather than replaced with something to be compared wrongly.
 *
 * The reader and writer are injected rather than opened here, the same seam
 * `crop.ts` and `rehash.ts` use.
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

export interface DerivableCapture extends CroppableBook {
  front_hash: string
}

/** `CaptureQueue` satisfies this. */
export interface CaptureSink extends CropSink {
  setFrontHash: (id: number, hash: string) => Promise<void>
}

/** Every capture that carries a photograph, for a backfill to work through. */
export interface CaptureSource extends CaptureSink {
  photographed: () => Promise<DerivableCapture[]>
}

/** Every queued capture whose front photograph has no hash on it yet. */
export interface UnhashedSource extends CaptureSink {
  unhashed: () => Promise<DerivableCapture[]>
}

/**
 * What became of the front hash. `refused` and `unreadable` are told apart
 * deliberately: the first is the detector doing its job on a frame with
 * nothing in it and will refuse again on retry; the second is a file that has
 * gone missing, a problem to fix.
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
 * front hash already stored is kept, so a second pass finds nothing to do.
 * `force` re-examines both, for use after a change to the detector or the hash
 * format.
 *
 * The hash runs first, deliberately: if cropping throws, the hash has already
 * happened, so a capture is never left unhashed by a crop failure. A capture
 * with no hash is a book the next person could photograph a second time
 * without being told, which is worse than one merely shown uncropped.
 */
export async function deriveCapture(
  sink: CaptureSink,
  capture: DerivableCapture,
  io: CropIo,
  options: CropOptions = {},
): Promise<CaptureOutcome> {
  const { apply = false, force = false } = options

  const hash = await hashFront(sink, capture, io, { apply, force })
  const crops = await cropPhotos(sink, capture, io, { apply, force })

  return { crops, hash }
}

/** What one sweep of the unhashed captures found and did. */
export interface HashSweep {
  /** Captures looked at, which is every one that had no hash when it started. */
  looked: number
  /** Fronts hashed and stored. */
  written: number
  /** Fronts with no detail in them, left unhashed rather than guessed. */
  refused: number
  /** Fronts whose file could not be read, which is a problem to fix. */
  unreadable: number
}

/**
 * Hash the front of every queued capture that has not got one, so an unhashed
 * capture is a state the app recovers from rather than a permanent one.
 *
 * Cheap by construction: it only looks at queued captures whose front
 * photograph carries no hash, which on a healthy server is none of them.
 * Running it twice costs a second pass over whatever is left and changes
 * nothing.
 *
 * A frame with no detail is still refused rather than guessed at, so it is
 * counted here on every sweep instead of being quietly given a hash that
 * would go on to be compared wrongly.
 */
export async function hashQueuedFronts(
  source: UnhashedSource,
  io: Pick<CropIo, 'read'>,
): Promise<HashSweep> {
  const sweep: HashSweep = { looked: 0, written: 0, refused: 0, unreadable: 0 }

  for (const capture of await source.unhashed()) {
    sweep.looked += 1
    const outcome = await hashFront(source, capture, io, { apply: true, force: false })
    if (outcome === 'written') sweep.written += 1
    else if (outcome === 'refused') sweep.refused += 1
    else if (outcome === 'unreadable') sweep.unreadable += 1
  }

  return sweep
}

/**
 * Hash the front photograph, in the one format `imagehash.ts` writes.
 *
 * Deliberately the original, not the crop: a match is decided by comparing
 * one hash against another, and a crop hashed here against a whole photograph
 * hashed elsewhere would score two different framings of the same book as
 * comparable when they are not. Same algorithm, same format tag, same input.
 *
 * Only the reader is wanted, not the writer: nothing here produces a file.
 */
export async function hashFront(
  sink: CaptureSink,
  capture: DerivableCapture,
  io: Pick<CropIo, 'read'>,
  options: { apply: boolean; force: boolean },
): Promise<HashOutcome> {
  if (!capture.front_image) return 'absent'
  if (capture.front_hash && !options.force) return 'kept'

  let source: Buffer
  try {
    source = Buffer.from(await io.read(capture.front_image))
  } catch {
    // A photograph that has gone missing leaves the stored hash as it was; a
    // stale hash is useless, but blanking it would lose the evidence the
    // capture was ever hashed. See rehash.ts.
    return 'unreadable'
  }

  let hash: string
  try {
    hash = await coverHash(source)
  } catch {
    // No detail in the frame, or bytes that are not an image; either way
    // there is nothing safe to store as a hash.
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
 * New captures are derived by the worker as their photographs arrive; this
 * exists for ones photographed before that ran. Nothing calls it on a timer
 * and no route triggers it: `crop-captures.ts` is the front end, and it is a
 * dry run unless told otherwise.
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
