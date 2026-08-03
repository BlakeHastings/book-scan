/**
 * The primary OCR engine, on its own.
 *
 * `identify.test.ts` exercises paddle through the whole pipeline, so a
 * failure there could be zbar, the tesseract ladder, the reading rules or
 * this. These run paddle directly against generated covers, so a break in the
 * engine says so in one line.
 *
 * Real OCR, real models, no mocks, which is the same trade the rest of the
 * suite makes: the browser scanner passed its unit tests and still could not
 * read a book. The models are downloaded once and cached on disk, and every
 * call here is a fraction of a second after that.
 */

import { afterAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { backCover, frontCover } from './fixtures'
import { paddleOcr, shutdownPaddle, warmPaddle } from './paddle'
import { extractIsbnsFromText } from '../shared/isbn'

const ISBN = '9780441013593' // Dune

/** The case OCR exists for: an ISBN that is printed but not in a barcode. */
const printedOnly = () => backCover(ISBN, { barcode: false, printedIsbn: true })

afterAll(async () => {
  await shutdownPaddle()
})

describe('reading a cover', () => {
  it('finds the printed ISBN when there is no barcode to read', async () => {
    // The measured claim this engine was chosen on, reduced to the one thing
    // it has to keep doing: the printed label comes back readable.
    const result = await paddleOcr(await printedOnly())

    expect(result).not.toBeNull()
    expect(extractIsbnsFromText(result!.text)).toContain(ISBN)
  }, 120_000)

  it('returns the ISBN as a line of its own, not only in the joined text', async () => {
    // `identify` harvests candidates from the lines as well as the text, so
    // an ISBN that only survives in one of the two is half a reading.
    const result = await paddleOcr(await printedOnly())

    const isbnLines = result!.lines.filter((line) => extractIsbnsFromText(line.text).length)
    expect(isbnLines).toHaveLength(1)
    expect(isbnLines[0]!.text).toContain('978-0-441-01359-3')
  }, 120_000)

  it('reads the blurb as well, so a line is a line and not a word', async () => {
    // Paddle groups words into lines itself. If that ever changed to one word
    // per line, height would stop meaning glyph size and pickTitle would
    // start choosing between fragments.
    const result = await paddleOcr(await printedOnly())

    expect(result!.lines.some((line) => line.words >= 5)).toBe(true)
    expect(result!.text).toContain('sweeping story')
  }, 120_000)
})

describe('the shape of what comes back', () => {
  it('gives the title the greatest height, which is how a title is found', async () => {
    // pickTitle picks by height. That only works if height tracks glyph size,
    // and this is the assertion that says it still does.
    const result = await paddleOcr(await frontCover('DUNE', 'Frank Herbert'))

    const tallest = [...result!.lines].sort((a, b) => b.height - a.height)[0]!
    expect(tallest.text.toUpperCase()).toContain('DUNE')
    for (const line of result!.lines) expect(line.height).toBeGreaterThan(0)
  }, 120_000)

  it('counts the words in each line and collapses the space between them', async () => {
    const result = await paddleOcr(await frontCover('DUNE', 'Frank Herbert'))

    expect(result!.lines.length).toBeGreaterThan(0)
    for (const line of result!.lines) {
      expect(line.text).not.toMatch(/\s\s|^\s|\s$/)
      expect(line.words).toBe(line.text.split(/\s+/).filter(Boolean).length)
    }
  }, 120_000)
})

describe('inputs that are not a cover', () => {
  it('reads a buffer that is a window onto a larger allocation', async () => {
    // Node hands out small buffers as views into a shared pool, so
    // `input.buffer` alone is somebody else's heap as well as this image.
    // Passing that to the engine reads the wrong bytes rather than failing,
    // which is why paddle.ts slices by byteOffset and byteLength.
    const image = await printedOnly()
    const view = Buffer.concat([Buffer.alloc(64), image]).subarray(64)
    expect(view.byteOffset).toBe(64)

    const plain = await paddleOcr(image)
    const offset = await paddleOcr(view)
    expect(offset!.text).toBe(plain!.text)
    expect(extractIsbnsFromText(offset!.text)).toContain(ISBN)
  }, 120_000)

  it('reports an empty reading for a blank frame rather than inventing one', async () => {
    const blank = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#ffffff' },
    }).png().toBuffer()

    const result = await paddleOcr(blank)
    expect(result).toEqual({ text: '', lines: [] })
  }, 120_000)

  it('returns null instead of throwing when the bytes are not an image', async () => {
    // A scan arriving as something other than a photo must not take the
    // request down with it: identify treats null as "this reader had
    // nothing" and carries on to the tesseract ladder.
    expect(await paddleOcr(Buffer.from('this is not an image at all'))).toBeNull()
  }, 60_000)
})

describe('the service behind it', () => {
  it('warms without throwing, and warming twice is harmless', async () => {
    await expect(warmPaddle()).resolves.toBeUndefined()
    await expect(warmPaddle()).resolves.toBeUndefined()
  }, 120_000)

  it('starts again after a shutdown', async () => {
    // The server shuts the engine down on exit, and a test file or a reload
    // can do it mid-life. The next call has to rebuild it rather than hand
    // back a destroyed session.
    await shutdownPaddle()

    const result = await paddleOcr(await frontCover('Neuromancer', 'William Gibson'))
    expect(result).not.toBeNull()
    expect(result!.text.toUpperCase()).toContain('NEUROMANCER')
  }, 120_000)

  it('shuts down cleanly when there is nothing running', async () => {
    await shutdownPaddle()
    await expect(shutdownPaddle()).resolves.toBeUndefined()
  }, 60_000)
})
