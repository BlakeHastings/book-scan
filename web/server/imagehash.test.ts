/**
 * The perceptual hash behind camera recognition, on its own.
 *
 * Two separate things are asserted here and they pull in opposite
 * directions. `coverHash` has to survive the everyday differences between two
 * photographs of one book (light, distance, crop, re-encoding) while still
 * telling two books apart. `distance` has to refuse anything it cannot
 * compare, because a cover hash decides which book somebody is holding and a
 * plausible looking number is worse than no number.
 *
 * Real sharp against generated images, no mocks. Nothing here opens a file or
 * a database.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { frontCover } from './fixtures'
import { coverHash, distance } from './imagehash'

/** What the difference hash used to write: sixteen hex characters, no tag. */
const OLD_FORMAT = '90006869d8680000'

/** The cutoff the shortlist in index.ts applies. */
const SHORTLIST = 24

/** A deterministic, detailed image. Nothing random, so a failure repeats. */
function noise(size = 200): Promise<Buffer> {
  const raw = Buffer.alloc(size * size * 3)
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 7919) % 256
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
}

const dune = () => frontCover('Dune', 'Frank Herbert')

describe('the hash a cover produces', () => {
  it('is tagged, sixteen hex characters, and the same every time', async () => {
    const image = await dune()
    const hash = await coverHash(image)

    expect(hash).toMatch(/^p1[0-9a-f]{16}$/)
    expect(await coverHash(image)).toBe(hash)
  }, 20_000)

  it('spends its leading bit on the dropped average brightness', async () => {
    // The first coefficient is the brightness of the whole crop, which says
    // nothing about which book this is, so it is thrown away and a zero
    // takes its place. That keeps the string 64 bits wide.
    const hash = await coverHash(await dune())
    expect(parseInt(hash[2]!, 16)).toBeLessThan(8)
  }, 20_000)

  it('sets half its bits, which is what a median threshold means', async () => {
    // A hash that had drifted to nearly all ones or nearly all zeros would
    // still compare and still look like a number, while carrying almost
    // nothing. 32 of 64 is the shape of a working one.
    const hash = await coverHash(await dune())
    const ones = [...hash.slice(2)]
      .map((c) => parseInt(c, 16).toString(2).split('1').length - 1)
      .reduce((a, b) => a + b, 0)

    expect(ones).toBe(32)
  }, 20_000)
})

describe('what it deliberately ignores', () => {
  it('ignores everything outside the middle of the frame', async () => {
    // The table, the hands and the wall around a held-up book change between
    // one session and the next while the cover does not, so the outer 30 per
    // cent is cropped away before anything is measured. Painting over
    // exactly that border must not move a single bit.
    const centre = await noise()
    const framed = await sharp(await noise())
      .composite([
        { input: { create: { width: 200, height: 30, channels: 3, background: '#ff0000' } }, top: 0, left: 0 },
        { input: { create: { width: 200, height: 30, channels: 3, background: '#00ff00' } }, top: 170, left: 0 },
        { input: { create: { width: 30, height: 200, channels: 3, background: '#0000ff' } }, top: 0, left: 0 },
        { input: { create: { width: 30, height: 200, channels: 3, background: '#ffff00' } }, top: 0, left: 170 },
      ])
      .png()
      .toBuffer()

    expect(await coverHash(framed)).toBe(await coverHash(centre))
  }, 20_000)

  it('survives a change of light', async () => {
    // Each coefficient is judged against the median of its own block, and
    // brightness and contrast move both sides together. A cover photographed
    // by a window and again under a lamp is the same book.
    const image = await dune()
    const hash = await coverHash(image)

    const brighter = await sharp(image).modulate({ brightness: 1.35 }).png().toBuffer()
    const flatter = await sharp(image).linear(0.6, 20).png().toBuffer()

    expect(distance(hash, await coverHash(brighter))).toBeLessThanOrEqual(4)
    expect(distance(hash, await coverHash(flatter))).toBeLessThanOrEqual(4)
  }, 20_000)

  it('survives being re-encoded and resized on the way in', async () => {
    // A phone sends JPEG at whatever resolution it feels like. The crop is
    // proportional and the grid is fixed, so neither should matter.
    const image = await dune()
    const hash = await coverHash(image)

    const jpeg = await sharp(image).jpeg({ quality: 60 }).toBuffer()
    const smaller = await sharp(image).resize(300).png().toBuffer()

    expect(distance(hash, await coverHash(jpeg))).toBeLessThanOrEqual(4)
    expect(distance(hash, await coverHash(smaller))).toBeLessThanOrEqual(4)
  }, 20_000)

  it('hashes an image too small to crop rather than failing on it', async () => {
    // Below 40 pixels the centre crop is skipped, because cropping a
    // thumbnail leaves nothing to transform.
    const thumbnail = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#888888' },
    })
      .composite([{ input: { create: { width: 8, height: 8, channels: 3, background: '#111111' } }, top: 2, left: 2 }])
      .png()
      .toBuffer()

    expect(await coverHash(thumbnail)).toMatch(/^p1[0-9a-f]{16}$/)
  }, 20_000)

  it('refuses bytes that are not an image instead of hashing them', async () => {
    // Better a rejected promise the caller has to handle than a hash of
    // nothing quietly written to the catalogue.
    await expect(coverHash(Buffer.from('not an image'))).rejects.toThrow()
  })
})

describe('a frame with nothing in it', () => {
  /** A solid colour, the size a phone sends. */
  const flat = (colour: string) =>
    sharp({ create: { width: 900, height: 1350, channels: 3, background: colour } })
      .png().toBuffer()

  /**
   * A plain ground with one line of type on it, which is the plainest thing
   * that is still a book. `size` is the fraction of the width the type gets.
   */
  async function plainCover(ground: string, ink: string, size: number): Promise<Buffer> {
    const width = 900
    const height = 1350
    const label = await sharp({
      text: {
        text: `<span foreground="${ink}">MEDITATIONS</span>`,
        font: 'Gelasio',
        fontfile: fileURLToPath(new URL('./fixtures-assets/Gelasio-Regular.ttf', import.meta.url)),
        rgba: true,
        align: 'centre',
        width: Math.round(width * size),
        height: Math.round(height * size * 0.2),
      },
    }).png().toBuffer()

    return sharp({ create: { width, height, channels: 3, background: ground } })
      .composite([{ input: label, gravity: 'centre' }])
      .png()
      .toBuffer()
  }

  it('refuses a solid colour instead of hashing it', async () => {
    // Every bit is the sign of one coefficient against the median of the
    // block. Shrink a flat surface to 32x32 and every coefficient except the
    // discarded average is floating point residue, and so is the median
    // between them, so every bit is decided by rounding. Rounding repeats:
    // measured across ten solid colours, every one landed within the 24 bit
    // shortlist cutoff of some other flat frame and six pairs landed at
    // zero, an exact match on nothing at all. The camera cannot tell it is
    // looking at a desk, so the hash has to.
    for (const colour of ['#000000', '#0a0a0a', '#303030', '#808080', '#c8c8c8', '#ffffff', '#3a5f8a', '#8a1f1f']) {
      await expect(coverHash(await flat(colour))).rejects.toThrow(/no detail/)
    }
  }, 30_000)

  it('refuses grain that averages away to nothing', async () => {
    // A wall in poor light is not perfectly flat, but the shrink to 32x32
    // averages faint grain out entirely, and what reaches the transform is
    // as blank as a painted rectangle.
    const size = 900
    const raw = Buffer.alloc(size * size * 3)
    let seed = 7
    for (let i = 0; i < size * size; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const value = 128 + ((seed % 3) - 1)
      raw[i * 3] = value
      raw[i * 3 + 1] = value
      raw[i * 3 + 2] = value
    }
    const grainy = await sharp(raw, { raw: { width: size, height: size, channels: 3 } })
      .png().toBuffer()

    await expect(coverHash(grainy)).rejects.toThrow(/no detail/)
  }, 20_000)

  it('still hashes a cover that is only a line of type on a plain ground', async () => {
    // The reason the threshold is where it is. Some real books are this
    // plain, and refusing one of those would be a worse bug than the one
    // this prevents. The strongest kept frequency of the last of these
    // measures 0.08 grey levels against a cutoff of 0.01, and of the first
    // 0.70, while a blank frame measures 1e-14.
    const plain = [
      await plainCover('#9a9a90', '#4a4a44', 0.22),
      await plainCover('#6a6a6a', '#8a8a8a', 0.22),
      await sharp(await plainCover('#6a6a6a', '#8a8a8a', 0.22)).linear(0.3, 0).png().toBuffer(),
    ]

    for (const cover of plain) {
      expect(await coverHash(cover)).toMatch(/^p1[0-9a-f]{16}$/)
    }
  }, 30_000)

  it('still hashes an ordinary cover taken in poor light', async () => {
    // Refusing has to cost nothing on a real photograph, however badly it
    // was taken. Dimmed to a tenth, washed out, and out of focus.
    const image = await dune()
    const awful = [
      await sharp(image).linear(0.12, 0).png().toBuffer(),
      await sharp(image).linear(0.15, 110).png().toBuffer(),
      await sharp(image).blur(25).png().toBuffer(),
    ]

    for (const bad of awful) {
      expect(await coverHash(bad)).toMatch(/^p1[0-9a-f]{16}$/)
    }
  }, 30_000)
})

describe('what it has to tell apart', () => {
  it('keeps a re-photographed cover nearer than a different book', async () => {
    const image = await dune()
    const other = await frontCover('The Dispossessed', 'Ursula Le Guin')

    // Crooked, brighter, slightly out of focus, sent as JPEG: one book,
    // photographed twice.
    const reshot = await sharp(image)
      .rotate(4, { background: '#111111' })
      .modulate({ brightness: 1.2 })
      .blur(1.3)
      .jpeg()
      .toBuffer()

    const same = distance(await coverHash(image), await coverHash(reshot))
    const different = distance(await coverHash(image), await coverHash(other))

    expect(same).toBeLessThan(different)
    expect(same).toBeLessThanOrEqual(SHORTLIST)
  }, 30_000)

  it('does not call an unrelated image a likeness', async () => {
    // Two things that share nothing should land near the 32 of 64 that two
    // unrelated images average, and well outside the shortlist cutoff.
    const apart = distance(await coverHash(await dune()), await coverHash(await noise()))

    expect(apart).toBeGreaterThan(SHORTLIST)
  }, 20_000)
})

describe('comparing two hashes', () => {
  const zeros = `p1${'0'.repeat(16)}`
  const ones = `p1${'f'.repeat(16)}`

  it('counts the bits that differ', () => {
    expect(distance(zeros, zeros)).toBe(0)
    expect(distance(zeros, `p1${'0'.repeat(15)}1`)).toBe(1)
    expect(distance(zeros, `p1${'0'.repeat(15)}f`)).toBe(4)
    expect(distance(zeros, ones)).toBe(64)
  })

  it('answers the same either way round', async () => {
    const a = await coverHash(await dune())
    const b = await coverHash(await noise())

    expect(distance(a, b)).toBe(distance(b, a))
    expect(distance(a, a)).toBe(0)
  }, 20_000)

  it('calls a missing hash no likeness at all', () => {
    // An unhashed book must never come back looking like a perfect match.
    expect(distance('', ones)).toBe(64)
    expect(distance(ones, '')).toBe(64)
    expect(distance('', '')).toBe(64)
  })

  it('calls a truncated or overlong hash no likeness at all', () => {
    expect(distance('p1abc', ones)).toBe(64)
    expect(distance(`${ones}00`, ones)).toBe(64)
  })

  it('refuses a hash written by the algorithm this replaced', () => {
    // Load-bearing, and the reason for the tag. An old difference hash is
    // the same width and drawn from the same alphabet, so comparing the two
    // yields a plausible number rather than an error. It has to fail closed:
    // even against an identical copy of itself.
    expect(distance(OLD_FORMAT, ones.slice(2))).toBe(64)
    expect(distance(OLD_FORMAT, OLD_FORMAT)).toBe(64)
    expect(distance(`p1${OLD_FORMAT}`, OLD_FORMAT)).toBe(64)
  })

  it('refuses a tagged hash whose payload is not hexadecimal', () => {
    // A corrupted column is not a near match to anything.
    expect(distance(`p1${'z'.repeat(16)}`, ones)).toBe(64)
    expect(distance(`p1${'0'.repeat(15)}?`, zeros)).toBe(64)
  })

  it('never reports more than the 64 bits it compares', async () => {
    const hash = await coverHash(await dune())
    for (const other of [zeros, ones, hash, OLD_FORMAT, '']) {
      expect(distance(hash, other)).toBeLessThanOrEqual(64)
      expect(distance(hash, other)).toBeGreaterThanOrEqual(0)
    }
  }, 20_000)
})
