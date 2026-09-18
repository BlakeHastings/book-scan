/**
 * Recognising a book by its cover rather than its barcode: a frequency hash
 * of the coarse arrangement of light and dark, which survives different
 * framing and lighting better than a pixel-by-pixel comparison.
 *
 * A frame with no detail in it is refused rather than hashed; see DETAIL. It
 * is not scale or rotation invariant and never will be, so this is a
 * shortlist generator, not an identification; everything it produces is put
 * in front of a person to confirm.
 */

import sharp from 'sharp'

/** The square the cover is reduced to before the transform. */
const GRID = 32

/** 8x8 kept frequencies, so 64 bits, written as 16 hex characters. */
const SIDE = 8

/**
 * Names the algorithm that wrote the hash. Two hashes from different
 * algorithms are not comparable; the tag makes the strings differ in length,
 * which `distance` already treats as no likeness at all.
 */
const FORMAT = 'p1'

/**
 * The middle of the frame, where the book is: a held-up book leaves table,
 * hands and wall around the edges that change between sessions while the
 * cover does not. Applied identically when storing and matching.
 */
const CENTRE = 0.7

/**
 * The gain a single cosine basis picks up in the unnormalised transform.
 *
 * Dividing a coefficient by this puts it back into grey levels, which is the
 * only unit a threshold can honestly be argued about.
 */
const GAIN = (GRID * GRID) / 4

/**
 * How far the strongest kept frequency has to sit from the median before the
 * bits mean anything, in grey levels out of 255.
 *
 * A blank or near-uniform frame produces coefficients that are floating point
 * residue, and rounding that into bits is not random: it repeats, so two
 * blank frames can land close together or at an exact match. This threshold
 * sits far below the weakest legible cover and far above a blank frame, so
 * there is no useful precision to lose between the two.
 */
const DETAIL = 0.01

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
 * A separable DCT-II of a GRID x GRID grey square: rows first, then columns,
 * which is GRID^3 multiplications each way rather than the GRID^4 a direct
 * transform would take. The usual orthonormal scaling is left off, since every
 * coefficient is compared with the median of its own block and a constant
 * factor moves both sides equally.
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

  // Nothing in the frame, so nothing to say about it: a hash of a blank
  // surface would be the same shape as a hash of a book, and would go on to
  // be compared and mistaken for one.
  const strongest = Math.max(...kept.map((value) => Math.abs(value - median)))
  if (strongest / GAIN < DETAIL) {
    throw new Error(
      'This frame carries no detail to hash: it is a flat surface, not a cover.',
    )
  }

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
 * Anything that is not a hash of the current format counts as no likeness at
 * all rather than as a number somebody might act on.
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
