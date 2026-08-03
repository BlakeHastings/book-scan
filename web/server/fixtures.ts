/**
 * Synthetic book covers for tests. Generating them beats checking in binaries
 * and lets a test state exactly which condition it is exercising (glossy,
 * rotated, price add-on beside the ISBN, and so on).
 *
 * Cover text is rendered with an embedded font (see fixtureText below)
 * instead of a system font name in SVG markup. A font named in SVG is
 * resolved by whatever fontconfig/DirectWrite finds installed on the machine
 * running the test, so "Georgia" is Georgia on a box that has it and some
 * unrelated substitute, at different metrics, on one that does not. That
 * silently changes what a fixture actually draws depending on which platform
 * ran the test, which is exactly what made a real bug (#1) hard to diagnose:
 * the images two platforms were asserting against were not the same images.
 */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// The bare "bwip-js" specifier resolves to the browser build under bundler
// module resolution, which has no Buffer-returning toBuffer. Ask for node.
import bwipjs from 'bwip-js/node'
import sharp, { type OverlayOptions } from 'sharp'

// Gelasio, metric-compatible with Georgia, SIL Open Font License 1.1 (see
// fixtures-assets/OFL.txt). Subset to ASCII, Latin-1 Supplement and a
// handful of typographic punctuation marks, which is everything the fixture
// text below needs. Passing this file straight to sharp's `fontfile` bypasses
// system font lookup entirely, so the same glyphs at the same metrics render
// on Windows and Linux alike, whatever fonts either machine happens to have.
const FONT_FAMILY = 'Gelasio'
const FONT_FILE = fileURLToPath(new URL('./fixtures-assets/Gelasio-Regular.ttf', import.meta.url))

// Fail loudly, at import time, if the embedded font is not where it should
// be. A fixture that quietly fell back to a system font would be exactly the
// silent-substitution bug this file exists to avoid, just moved one level
// up, so this check does not try to be clever about it: no file, no tests.
if (!fs.existsSync(FONT_FILE)) {
  throw new Error(
    `Test fixture font is missing: ${FONT_FILE}\n` +
    'Cover fixtures render title, author and blurb text with an embedded ' +
    `font (${FONT_FAMILY}) so they look identical on every platform. ` +
    'Without the font file, sharp would silently fall back to whatever ' +
    'font the host happens to have installed, which is the exact bug this ' +
    'is here to prevent. Restore server/fixtures-assets/Gelasio-Regular.ttf.',
  )
}

interface RenderedText {
  input: Buffer
  width: number
  height: number
}

/**
 * Render text with the embedded font, auto-fit to a pixel box.
 *
 * Passing both `width` and `height` makes sharp choose the largest point
 * size that fits the text inside that box, wrapping to more lines only if a
 * single line will not fit. That is what keeps a long title such as "The
 * Dispossessed" on the canvas: rather than a fixed point size that happens
 * to fit one font's metrics and overflow another's, the box is fixed and the
 * size adapts to whatever the (now single, embedded) font actually measures.
 */
async function fixtureText(
  text: string,
  box: { width: number, height: number },
): Promise<RenderedText> {
  const png = await sharp({
    text: {
      text: escapePangoMarkup(text),
      font: FONT_FAMILY,
      fontfile: FONT_FILE,
      rgba: true,
      align: 'centre',
      width: box.width,
      height: box.height,
    },
  }).png().toBuffer()

  const { width, height } = await sharp(png).metadata()
  return { input: png, width: width!, height: height! }
}

// sharp's text input accepts Pango markup, so a literal "&" or "<" in a
// title or author string would otherwise be parsed as markup rather than
// drawn as a character.
function escapePangoMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Centre a rendered text image horizontally, anchored on a vertical centre. */
function centred(rendered: RenderedText, canvasWidth: number, centreY: number): OverlayOptions {
  return {
    input: rendered.input,
    left: Math.max(0, Math.round((canvasWidth - rendered.width) / 2)),
    top: Math.max(0, Math.round(centreY - rendered.height / 2)),
  }
}

/** Left-align a rendered text image at a fixed position. */
function positioned(rendered: RenderedText, left: number, top: number): OverlayOptions {
  return { input: rendered.input, left, top }
}

export async function barcodePng(isbn: string, scale = 3): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'ean13',
    text: isbn,
    scale,
    height: 18,
    includetext: true,
    textxalign: 'center',
    paddingwidth: 10,
    paddingheight: 10,
    backgroundcolor: 'FFFFFF',
  })
}

export interface BackCoverOptions {
  /**
   * Use a retail UPC-A instead of a Bookland EAN, with the ISBN printed only
   * as text. This is how US mass-market paperbacks looked before ISBN-13,
   * and it is the case that defeats barcode-only identification.
   */
  upc?: string
  /** Print the ISBN-10 form rather than the 13. */
  printIsbn10?: string
  /** Print "ISBN 978-..." as text as well as the barcode. */
  printedIsbn?: boolean
  /** Include the barcode itself. */
  barcode?: boolean
  /** Add an EAN-5 price add-on beside the ISBN, as most US paperbacks have. */
  priceAddOn?: boolean
  rotate?: number
}

/** A plausible back cover: blurb, barcode, printed ISBN. */
export async function backCover(
  isbn: string,
  options: BackCoverOptions = {},
): Promise<Buffer> {
  const {
    printedIsbn = true, barcode = true, priceAddOn = false, rotate = 0,
    upc, printIsbn10,
  } = options

  const hyphenated = `${isbn.slice(0, 3)}-${isbn.slice(3, 4)}-${isbn.slice(4, 7)}-${isbn.slice(7, 12)}-${isbn.slice(12)}`

  const composites: OverlayOptions[] = [
    positioned(await fixtureText('A NOVEL', { width: 780, height: 60 }), 60, 70),
    positioned(
      await fixtureText('Praise for this remarkable book from the author.', { width: 780, height: 45 }),
      60, 170,
    ),
    positioned(
      await fixtureText('A sweeping story of sand, spice and succession.', { width: 780, height: 45 }),
      60, 240,
    ),
  ]
  if (upc) {
    // A retail UPC-A, which is what a pre-ISBN-13 paperback carries. It has a
    // valid checksum and is not a book identifier.
    composites.push({
      input: await bwipjs.toBuffer({
        bcid: 'upca', text: upc, scale: 3, height: 18, includetext: true,
        paddingwidth: 10, paddingheight: 10, backgroundcolor: 'FFFFFF',
      }),
      top: 920, left: 60,
    })
  } else if (barcode) {
    composites.push({ input: await barcodePng(isbn), top: 920, left: 60 })
  }
  if (priceAddOn) {
    const addOn = await bwipjs.toBuffer({
      bcid: 'ean5', text: '51999', scale: 3, height: 18,
      includetext: true, paddingwidth: 10, paddingheight: 10,
      backgroundcolor: 'FFFFFF',
    })
    composites.push({ input: addOn, top: 920, left: 520 })
  }
  if (printedIsbn) {
    const printed = printIsbn10
      ? printIsbn10.replace(/^(.)(...)(.....)(.)$/, '$1-$2-$3-$4')
      : hyphenated
    composites.push(positioned(await fixtureText(`ISBN ${printed}`, { width: 780, height: 45 }), 60, 855))
  }

  // Render fully before rotating. sharp applies rotate BEFORE composite within
  // a single pipeline no matter which order you call them, so rotating inline
  // here silently pushed the barcode off the canvas.
  const composed = await sharp({
    create: { width: 900, height: 1250, channels: 3, background: '#ffffff' },
  }).composite(composites).png().toBuffer()
  if (!rotate) return composed

  return sharp(composed).rotate(rotate, { background: '#ffffff' }).png().toBuffer()
}

/** A front cover: big title, smaller author and cover noise. */
export async function frontCover(title: string, author: string): Promise<Buffer> {
  const width = 900
  const height = 1350

  const composites = [
    centred(await fixtureText('NEW YORK TIMES BESTSELLER', { width: 780, height: 50 }), width, 175),
    // Fixed width and height, not a fixed point size: the title auto-fits
    // whatever this box can hold, so a long title shrinks to stay on one
    // line instead of overflowing the canvas the way it would at a font
    // size tuned for one platform's metrics.
    centred(await fixtureText(title, { width: 820, height: 220 }), width, 620),
    centred(await fixtureText(author, { width: 780, height: 90 }), width, 820),
    centred(await fixtureText('A NOVEL', { width: 700, height: 50 }), width, 1250),
  ]

  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer()
}

/** Simulate a glossy cover: low contrast plus a bright diagonal highlight. */
export async function glossy(input: Buffer): Promise<Buffer> {
  const { width = 900, height = 1250 } = await sharp(input).metadata()
  const glare = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.0"/>
        <stop offset="45%" stop-color="#ffffff" stop-opacity="0.55"/>
        <stop offset="60%" stop-color="#ffffff" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
  </svg>`

  return sharp(input)
    // Squash contrast the way a phone flash on laminate does.
    .linear(0.62, 58)
    .composite([{ input: Buffer.from(glare), blend: 'over' }])
    .png()
    .toBuffer()
}
