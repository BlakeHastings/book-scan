/**
 * The publisher's cover, fetched rather than photographed: a clean,
 * straight-on image of the front to compare a held-up book against.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'

/**
 * Open Library indexes covers by ISBN directly, so a backfill needs no
 * metadata lookup at all. `default=false` makes a miss a 404 rather than a
 * placeholder image, which would otherwise be stored as though it were a real
 * cover.
 */
// Overridable so a test run can take this off the network. Unset in normal use.
const COVERS_ORIGIN = process.env.BOOKSCAN_COVERS_URL || 'https://covers.openlibrary.org'

export function openLibraryCover(isbn: string): string {
  return `${COVERS_ORIGIN}/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`
}

/**
 * Google serves a postage stamp by default. zoom=1 is the ~128px thumbnail;
 * asking for a larger one costs nothing and the difference is the difference
 * between recognising a cover and squinting at it.
 */
export function upgradeGoogleCover(url: string): string {
  if (!/books\.google/.test(url)) return url
  return url.replace(/&zoom=\d+/, '&zoom=2').replace(/&edge=curl/, '')
}

/** Smallest image worth keeping. Below this it is a placeholder or an error. */
const MIN_COVER_PX = 80

/**
 * Download one cover and normalise it.
 *
 * Re-encoded rather than stored as sent: the sources vary from 128px GIFs to
 * multi-megabyte PNGs, and this is going next to three phone photos of the
 * same book. Returns '' for anything that is not a usable image, which
 * includes the several ways these endpoints say "no cover" with a 200.
 */
export async function downloadCover(
  url: string,
  isbn: string,
  dir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!url) return ''

  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return ''

    const raw = Buffer.from(await response.arrayBuffer())
    if (raw.length < 1024) return ''

    const meta = await sharp(raw).metadata()
    if ((meta.width ?? 0) < MIN_COVER_PX || (meta.height ?? 0) < MIN_COVER_PX) return ''

    const jpeg = await sharp(raw)
      .resize({ width: 1000, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 82 })
      .toBuffer()

    // A timestamp alone can collide if two covers save in the same
    // millisecond, and an ISBN-less book would collide with every other
    // ISBN-less book on the 'noisbn' literal. The random suffix makes the
    // name unique regardless of timing, without hashing the image content,
    // which would also deduplicate identical covers, a storage-behaviour
    // change this is not making.
    const name = `${Date.now()}_${isbn || 'noisbn'}_${randomBytes(4).toString('hex')}_cover.jpg`
    writeFileSync(join(dir, name), jpeg)
    return name
  } catch {
    // A missing cover is normal and not worth failing a save over.
    return ''
  }
}
