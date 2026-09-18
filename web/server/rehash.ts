/**
 * Bringing stored cover hashes up to the current algorithm.
 *
 * `imagehash.ts` refuses to compare a hash it did not write, so every hash
 * already in the catalogue answers "no likeness at all" until its image is
 * read and hashed again.
 *
 * The images are the record; the hash is derived from them, so recomputing it
 * invents nothing and can be redone as often as needed.
 *
 * The image reader is injected rather than opened here, so the caller decides
 * which directory is read and tests need none at all.
 */

import { coverHash, distance } from './imagehash'
import type { Store } from './store'

/** The two images a book can be recognised by, and their hash columns. */
const SLOTS = [
  { image: 'front_image', hash: 'front_hash', name: 'front' },
  { image: 'cover_image', hash: 'cover_hash', name: 'cover' },
] as const

export interface HashRow {
  id: number
  title: string
  front_image: string
  cover_image: string
  front_hash: string
  cover_hash: string
}

/** Reads a stored image by file name. Throws if it is missing or unreadable. */
export type ReadImage = (name: string) => Buffer | Promise<Buffer>

export interface RehashOptions {
  /** Write the new hashes. Without it nothing is written at all. */
  apply?: boolean
  /** Recompute hashes that are already in the current format. */
  force?: boolean
  read: ReadImage
  /** Called once per image with a line worth showing an operator. */
  onNote?: (line: string) => void
}

export interface RehashFailure {
  id: number
  title: string
  /** The file that could not be read, or '' when none was ever recorded. */
  image: string
  reason: string
}

export interface RehashReport {
  /** Book rows examined. */
  rows: number
  /** Stored images considered across those rows. */
  images: number
  /** Images read and hashed again. */
  rehashed: number
  /** Images left alone because their hash is already current. */
  skipped: number
  /** Images that could not be hashed. One entry in `failures` each. */
  failed: number
  failures: RehashFailure[]
  /** Rows whose stored hashes changed, or would have changed on a dry run. */
  changed: number
}

/**
 * Would the matcher still accept this hash?
 *
 * Comparing a hash against itself reuses `distance`'s own format check rather
 * than duplicating the format tag here. The length check rejects a truncated
 * string that is all tag and no payload, which would otherwise look like a
 * perfect self-match.
 */
export function isCurrentFormat(hash: string): boolean {
  return hash.length >= 16 && distance(hash, hash) === 0
}

/**
 * Recompute the cover hashes of every catalogued image.
 *
 * Idempotent: a row whose hash the matcher already accepts is skipped, so a
 * second run finds nothing to do.
 *
 * An image that cannot be read leaves the existing hash exactly as it was: a
 * stale hash is useless, but blanking it would lose the evidence the row was
 * ever hashed.
 */
export async function rehashCovers(
  store: Store,
  options: RehashOptions,
): Promise<RehashReport> {
  const { apply = false, force = false, read, onNote } = options
  const note = onNote ?? (() => {})

  const report: RehashReport = {
    rows: 0,
    images: 0,
    rehashed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    changed: 0,
  }

  for (const row of await store.imageHashes()) {
    report.rows += 1
    const next: Record<(typeof SLOTS)[number]['hash'], string> = {
      front_hash: row.front_hash ?? '',
      cover_hash: row.cover_hash ?? '',
    }
    let rowChanged = false

    for (const slot of SLOTS) {
      const image = row[slot.image] ?? ''
      const current = row[slot.hash] ?? ''

      if (!image) {
        // No file to read. Harmless unless a hash is sitting there that the
        // matcher will not accept, in which case this row can never be fixed
        // by this tool and somebody has to know.
        if (current && !isCurrentFormat(current)) {
          report.failed += 1
          report.failures.push({
            id: row.id,
            title: row.title,
            image: '',
            reason: `${slot.name} hash is in an old format but no ${slot.name} image is recorded`,
          })
        }
        continue
      }

      report.images += 1

      if (!force && isCurrentFormat(current)) {
        report.skipped += 1
        continue
      }

      let hash: string
      try {
        hash = await coverHash(Buffer.from(await read(image)))
      } catch (caught) {
        // A cover photo that has gone missing must not cost us the rows that
        // follow it, so this is counted and named rather than thrown.
        report.failed += 1
        report.failures.push({
          id: row.id,
          title: row.title,
          image,
          reason: (caught as Error).message,
        })
        continue
      }

      report.rehashed += 1
      if (hash !== current) {
        next[slot.hash] = hash
        rowChanged = true
        note(`book ${row.id} ${slot.name}: ${current || '(none)'} -> ${hash}`)
      }
    }

    if (!rowChanged) continue
    report.changed += 1
    if (apply) await store.setHashes(row.id, next.front_hash, next.cover_hash)
  }

  return report
}
