/**
 * Recognising a book by its cover rather than its barcode.
 *
 * A difference hash: shrink the image to almost nothing, then record whether
 * each pixel is brighter than the one to its right. What survives is the
 * coarse layout of light and dark, which is what a cover mostly is, and what
 * a phone photo of one still resembles under different light, at a different
 * distance, held slightly crooked.
 *
 * It is not scale or rotation invariant and it never will be, so this is a
 * shortlist generator, not an identification. Everything it produces is put
 * in front of a person to confirm.
 */

import sharp from 'sharp'

/** 8x8 comparisons, so 64 bits, written as 16 hex characters. */
const SIDE = 8

/**
 * The middle of the frame, which is where the book is.
 *
 * A held-up book leaves table, hands and wall around the edges, and those
 * change between one session and the next while the cover does not. Cropping
 * in throws away most of that. Applied identically when storing and when
 * matching, so the two are always comparing like with like.
 */
const CENTRE = 0.8

export async function coverHash(input: Buffer): Promise<string> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0

  let pipeline = sharp(input)
  if (width > 40 && height > 40) {
    pipeline = pipeline.extract({
      left: Math.round((width * (1 - CENTRE)) / 2),
      top: Math.round((height * (1 - CENTRE)) / 2),
      width: Math.round(width * CENTRE),
      height: Math.round(height * CENTRE),
    })
  }

  const { data } = await pipeline
    .grayscale()
    .normalise()
    // One extra column: each row yields SIDE comparisons from SIDE+1 pixels.
    .resize(SIDE + 1, SIDE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  let bits = ''
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      const left = data[y * (SIDE + 1) + x]!
      const right = data[y * (SIDE + 1) + x + 1]!
      bits += left > right ? '1' : '0'
    }
  }

  // Hex rather than a bigint so it stores and compares as a plain column.
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return hex
}

const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

/**
 * How many of the 64 bits differ. Lower is more alike; 0 is identical and 32
 * is what two unrelated images average, since half the bits agree by chance.
 */
export function distance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let total = 0
  for (let i = 0; i < a.length; i += 1) {
    total += BITS[parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)]!
  }
  return total
}
