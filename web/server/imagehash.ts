/**
 * Recognising a book by its cover rather than its barcode.
 *
 * A frequency hash. Shrink the middle of the frame to a 32x32 grey square,
 * take a two dimensional discrete cosine transform of it, then keep only the
 * lowest eight by eight frequencies and record which of them sit above the
 * median of that block. What survives is the coarse arrangement of light and
 * dark across the cover, described as frequency rather than as pixels, which
 * is what a phone photo of a cover still resembles under different light, at
 * a different distance, held slightly crooked.
 *
 * This replaced a difference hash, which compared each shrunken pixel with
 * the one to its right. That reads only horizontal edges, and a book cover is
 * mostly flat: rows of a jacket that carry no horizontal edge produced a bit
 * decided by rounding rather than by the cover, so a re-photograph moved bits
 * that a genuinely different book left alone. Measured over thirty generated
 * covers and five kinds of re-photograph, the difference hash put the right
 * book first 82 to 86 percent of the time and put a wrong book first and
 * inside the shortlist cutoff on 21 to 25 of 150 queries. This puts the right
 * book first 89 to 91 percent of the time and a wrong book first on 13 to 15.
 * On covers that are mostly type on a plain ground, where horizontal edges
 * are scarcest, the difference hash was at 48 to 52 percent, a coin toss, and
 * this is at 70 to 78.
 *
 * It is still not scale or rotation invariant and it never will be, so this
 * is a shortlist generator, not an identification. Everything it produces is
 * put in front of a person to confirm.
 */

import sharp from 'sharp'

/** The square the cover is reduced to before the transform. */
const GRID = 32

/** 8x8 kept frequencies, so 64 bits, written as 16 hex characters. */
const SIDE = 8

/**
 * Names the algorithm that wrote the hash.
 *
 * Two hashes from different algorithms are not comparable, and comparing them
 * anyway yields a plausible looking number rather than an error. A cover hash
 * decides which book a camera is being pointed at, and the wrong answer gets
 * written to the catalogue, so a stale hash has to fail to match rather than
 * match something. The tag makes the strings differ in length, which
 * `distance` already treats as no likeness at all.
 */
const FORMAT = 'p1'

/**
 * The middle of the frame, which is where the book is.
 *
 * A held-up book leaves table, hands and wall around the edges, and those
 * change between one session and the next while the cover does not. Cropping
 * in throws away most of that. Applied identically when storing and when
 * matching, so the two are always comparing like with like.
 */
const CENTRE = 0.7

/**
 * cos((2x + 1) u pi / 2N), the only trigonometry the transform needs.
 *
 * The same GRID x GRID table serves every hash, so it is built once.
 */
const COSINE = Array.from({ length: GRID }, (_, u) =>
  Float64Array.from({ length: GRID }, (_, x) =>
    Math.cos(((2 * x + 1) * u * Math.PI) / (2 * GRID)),
  ),
)

/**
 * A separable DCT-II of a GRID x GRID grey square.
 *
 * Rows first, then columns, which is GRID^3 multiplications each way rather
 * than the GRID^4 a direct transform would take. The usual orthonormal
 * scaling is left off: every coefficient is compared with the median of its
 * own block, and a constant factor moves both sides equally.
 */
function transform(pixels: Uint8Array | Buffer): Float64Array {
  const rows = new Float64Array(GRID * GRID)
  for (let y = 0; y < GRID; y += 1) {
    for (let u = 0; u < GRID; u += 1) {
      const basis = COSINE[u]!
      let sum = 0
      for (let x = 0; x < GRID; x += 1) sum += pixels[y * GRID + x]! * basis[x]!
      rows[y * GRID + u] = sum
    }
  }

  const out = new Float64Array(GRID * GRID)
  for (let v = 0; v < GRID; v += 1) {
    const basis = COSINE[v]!
    for (let u = 0; u < GRID; u += 1) {
      let sum = 0
      for (let y = 0; y < GRID; y += 1) sum += rows[y * GRID + u]! * basis[y]!
      out[v * GRID + u] = sum
    }
  }
  return out
}

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
    // No contrast stretch: each coefficient is judged against the median of
    // its own block, which a change of brightness or contrast moves too.
    .resize(GRID, GRID, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const coefficients = transform(data)

  // The lowest frequencies, minus the very first. That one is the average
  // brightness of the whole crop, which says nothing about which book this
  // is and would drag the median towards itself.
  const kept: number[] = []
  for (let v = 0; v < SIDE; v += 1) {
    for (let u = 0; u < SIDE; u += 1) {
      if (u === 0 && v === 0) continue
      kept.push(coefficients[v * GRID + u]!)
    }
  }

  const sorted = [...kept].sort((a, b) => a - b)
  const median = (sorted[30]! + sorted[31]!) / 2

  // The dropped average takes the leading bit's place, so the string is still
  // 64 bits and still 16 hex characters.
  let bits = '0'
  for (const value of kept) bits += value > median ? '1' : '0'

  // Hex rather than a bigint so it stores and compares as a plain column.
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return FORMAT + hex
}

const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

/**
 * How many of the 64 bits differ. Lower is more alike; 0 is identical and 32
 * is what two unrelated images average, since half the bits agree by chance.
 *
 * Anything that is not a hash of the current format, including one written by
 * an earlier algorithm, counts as no likeness at all rather than as a number
 * somebody might act on.
 */
export function distance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  if (!a.startsWith(FORMAT) || !b.startsWith(FORMAT)) return 64

  let total = 0
  for (let i = FORMAT.length; i < a.length; i += 1) {
    const left = parseInt(a[i]!, 16)
    const right = parseInt(b[i]!, 16)
    if (Number.isNaN(left) || Number.isNaN(right)) return 64
    total += BITS[left ^ right]!
  }
  return total
}
