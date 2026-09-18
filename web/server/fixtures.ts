/**
 * Synthetic book covers for tests. Generating them beats checking in binaries
 * and lets a test state exactly which condition it is exercising.
 *
 * Cover text is rendered with an embedded font (see fixtureText below)
 * rather than a system font name, since a font named in SVG is resolved by
 * whatever fontconfig or DirectWrite finds installed on the machine running
 * the test, so the same name can resolve to a different font, at different
 * metrics, on different platforms.
 */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// The bare "bwip-js" specifier resolves to the browser build under bundler
// module resolution, which has no Buffer-returning toBuffer. Ask for node.
import bwipjs from 'bwip-js/node'
import sharp, { type OverlayOptions } from 'sharp'

// Gelasio, metric-compatible with Georgia, SIL Open Font License 1.1 (see
// fixtures-assets/OFL.txt), subset to ASCII, Latin-1 Supplement and the
// punctuation the fixture text needs. Passing this file straight to sharp's
// `fontfile` bypasses system font lookup, so text lays out at the same
// metrics on every platform.
//
// Metrics match, but rasterised pixels do not: the same text differs by a
// handful of pixel levels along the glyph edges between platforms. No test
// may depend on an exact pixel match where text is involved; see the note on
// the title position in `colouredCover`.
const FONT_FAMILY = 'Gelasio'
const FONT_FILE = fileURLToPath(new URL('./fixtures-assets/Gelasio-Regular.ttf', import.meta.url))

// Checked at import time: a fixture that silently fell back to a system font
// would reintroduce the platform drift this file exists to avoid.
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
 * size that fits the text in the box, wrapping only if a single line will
 * not fit.
 */
async function fixtureText(
  text: string,
  box: { width: number, height: number },
  /** Pango colour for the glyphs; black when omitted. */
  ink?: string,
): Promise<RenderedText> {
  const escaped = escapePangoMarkup(text)
  const png = await sharp({
    text: {
      text: ink ? `<span foreground="${ink}">${escaped}</span>` : escaped,
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

function centred(rendered: RenderedText, canvasWidth: number, centreY: number): OverlayOptions {
  return {
    input: rendered.input,
    left: Math.max(0, Math.round((canvasWidth - rendered.width) / 2)),
    top: Math.max(0, Math.round(centreY - rendered.height / 2)),
  }
}

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
   * A retail UPC-A rather than a Bookland EAN, with the ISBN printed only as
   * text: how US mass-market paperbacks looked before ISBN-13, and the case
   * that defeats barcode-only identification.
   */
  upc?: string
  printIsbn10?: string
  printedIsbn?: boolean
  barcode?: boolean
  /** An EAN-5 price add-on beside the barcode, as on most US paperbacks. */
  priceAddOn?: boolean
  rotate?: number
}

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
    // A valid UPC-A checksum, but not a book identifier.
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

/** Shaped like what `SPINE_CROP` saves, so a scene built around this is the shape the edge slot really holds. */
export async function spine(title: string, author: string): Promise<Buffer> {
  const width = 150
  const height = 1250

  // Pango rotates nothing, so the text is drawn along a wide canvas and the
  // whole strip is turned a quarter turn at the end.
  const laid = await sharp({ create: { width: height, height: width, channels: 3, background: '#f2ede4' } })
    .composite([
      positioned(await fixtureText(title, { width: 700, height: 70 }), 200, 30),
      positioned(await fixtureText(author, { width: 260, height: 46 }), 960, 45),
    ])
    .png()
    .toBuffer()

  return sharp(laid).rotate(90).png().toBuffer()
}

/**
 * A cover on coloured paper, optionally with a printed contrasting band
 * (`rule`), which is what the edge of a title bar or a divider actually
 * looks like: a strong straight line with the same cover on both sides of it.
 * A crop that stops there has cut the book in half.
 */
export async function colouredCover(
  title: string,
  author: string,
  paper: string,
  ink: string,
  rule?: { colour: string, thickness: number, at: number },
): Promise<Buffer> {
  const width = 900
  const height = 1350

  const composites: OverlayOptions[] = []
  if (rule) {
    composites.push({
      input: await sharp({
        create: { width, height: rule.thickness, channels: 3, background: rule.colour },
      }).png().toBuffer(),
      left: 0,
      top: Math.round(height * rule.at),
    })
  }
  // The title sits where `frontCover` puts its own title, and it has to: the
  // detector's line-snapping search can settle on either the title's top edge
  // or the book's, and glyph-edge pixels are not the same on every machine
  // (see the note at the top of this file).
  //
  // `rule` is placed at 28 per cent of the way down on purpose, far outside
  // the snap band, so it tests the far-offset check rather than the snapping
  // search.
  composites.push(
    centred(await fixtureText(title, { width: 700, height: 180 }, ink), width, 620),
    centred(await fixtureText(author, { width: 620, height: 80 }, ink), width, 1120),
  )

  return sharp({ create: { width, height, channels: 3, background: paper } })
    .composite(composites)
    .png()
    .toBuffer()
}

/** A spine on coloured paper, for the same reason `colouredCover` exists. */
export async function colouredSpine(
  title: string,
  paper: string,
  ink: string,
): Promise<Buffer> {
  const width = 150
  const height = 1250

  const laid = await sharp({ create: { width: height, height: width, channels: 3, background: paper } })
    .composite([positioned(await fixtureText(title, { width: 700, height: 70 }, ink), 200, 35)])
    .png()
    .toBuffer()

  return sharp(laid).rotate(90).png().toBuffer()
}

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

/** A rectangle in image pixels, the same shape `bookcrop` returns. */
export interface FixtureRect {
  left: number
  top: number
  width: number
  height: number
}

export interface Scene {
  image: Buffer
  /** Where the book actually is. Axis aligned, corners included when tilted. */
  rect: FixtureRect
}

export type SceneBackground = 'carpet' | 'floorboards' | 'rug' | 'plain'

export interface SceneOptions {
  /** Everything random here is drawn from this, so a run repeats exactly. */
  seed?: number
  width?: number
  height?: number
  background?: SceneBackground
  /** Fraction of the frame's width the book covers before any rotation. */
  fill?: number
  /** Degrees. */
  rotate?: number
  /** Rectangular things that are not the book: a table edge, a shelf, a mat. */
  distractors?: number
  /** Drop a soft shadow under the book, which puts an edge just outside it. */
  shadow?: boolean
  /** 0 to 1. How near the background's brightness is to the book's own. */
  camouflage?: number
  /**
   * Per-channel multipliers for the background: red, then green, then blue.
   * Defaults to neutral grey; a tint such as `[1.15, 0.85, 0.6]` differs from
   * a dark cover in hue rather than brightness, which plain grey cannot test.
   */
  backgroundTint?: [number, number, number]
}

/** Deterministic, so a measured accuracy is the same number tomorrow. */
function rng(seed: number): () => number {
  let state = (seed | 0) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 100000) / 100000
  }
}

function backgroundPixels(
  width: number,
  height: number,
  style: SceneBackground,
  random: () => number,
  camouflage: number,
  tint: [number, number, number],
): Buffer {
  // Camouflage lifts the floor brightness toward the cover's own near-white,
  // removing the outline a detector relies on.
  const base = 60 + Math.round(camouflage * 150)
  const raw = Buffer.alloc(width * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = base

      if (style === 'carpet') {
        value += (random() - 0.5) * 46
      } else if (style === 'floorboards') {
        // Long straight seams, which is the distractor a line-based detector
        // is most likely to mistake for the edge of a book.
        const plank = Math.floor(y / 130)
        value += plank % 2 ? 12 : -12
        if (y % 130 < 3) value -= 45
        value += (random() - 0.5) * 16
      } else if (style === 'rug') {
        const cell = Math.floor(x / 90) + Math.floor(y / 90)
        value += cell % 2 ? 26 : -26
        value += (random() - 0.5) * 22
      } else {
        value += (random() - 0.5) * 8
      }

      // Brighter towards one side. Real photographs are not evenly lit.
      value += Math.round((x / width) * 26 - 13)

      const clamped = Math.max(0, Math.min(255, Math.round(value)))
      const channel = (v: number, multiplier: number): number =>
        Math.max(0, Math.min(255, Math.round(v * multiplier)))
      const i = (y * width + x) * 3
      raw[i] = channel(clamped, tint[0])
      raw[i + 1] = channel(Math.max(0, clamped - 2), tint[1])
      raw[i + 2] = channel(Math.max(0, clamped - 8), tint[2])
    }
  }

  return raw
}

/**
 * `subject` is rotated first, so the returned rectangle is the axis-aligned
 * box around the tilted book, corners included, which is what a crop has to
 * contain in order not to cut it.
 */
export async function photographedBook(
  subject: Buffer,
  options: SceneOptions = {},
): Promise<Scene> {
  const {
    seed = 1,
    width = 1100,
    height = 1500,
    background = 'carpet',
    fill = 0.5,
    rotate = 0,
    distractors = 0,
    shadow = true,
    camouflage = 0,
    backgroundTint = [1, 1, 1],
  } = options

  const random = rng(seed)

  const targetWidth = Math.max(8, Math.round(width * fill))
  // Bounded on both axes: a spine is tall enough that asking for a width
  // alone would make it taller than the photograph it is supposed to sit in.
  const resized = await sharp(subject)
    .resize({ width: targetWidth, height: Math.round(height * 0.86), fit: 'inside' })
    .png()
    .toBuffer()

  // Rotating on a transparent background grows the canvas to the tilted
  // rectangle's own bounding box, so the composited size is the ground truth.
  const book = rotate
    ? await sharp(resized)
      .rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    : resized

  const meta = await sharp(book).metadata()
  const bookWidth = meta.width ?? targetWidth
  const bookHeight = meta.height ?? targetWidth

  const left = Math.max(0, Math.min(width - bookWidth,
    Math.round((width - bookWidth) * (0.2 + random() * 0.6))))
  const top = Math.max(0, Math.min(height - bookHeight,
    Math.round((height - bookHeight) * (0.2 + random() * 0.6))))

  const layers: OverlayOptions[] = []

  for (let n = 0; n < distractors; n++) {
    const dw = Math.round(width * (0.25 + random() * 0.5))
    const dh = Math.round(height * (0.1 + random() * 0.3))
    const shade = Math.round(30 + random() * 60)
    layers.push({
      input: await sharp({
        create: { width: dw, height: dh, channels: 3, background: { r: shade, g: shade, b: shade + 6 } },
      }).png().toBuffer(),
      left: Math.round(random() * Math.max(1, width - dw)),
      top: Math.round(random() * Math.max(1, height - dh)),
    })
  }

  const shadowLeft = left + 10
  const shadowTop = top + 12
  const shadowWidth = bookWidth + 18
  const shadowHeight = bookHeight + 18
  if (shadow && shadowLeft + shadowWidth <= width && shadowTop + shadowHeight <= height) {
    layers.push({
      input: await sharp({
        create: {
          width: shadowWidth,
          height: shadowHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0.45 },
        },
      }).blur(9).png().toBuffer(),
      left: shadowLeft,
      top: shadowTop,
    })
  }

  layers.push({ input: book, left, top })

  const image = await sharp(backgroundPixels(width, height, background, random, camouflage, backgroundTint), {
    raw: { width, height, channels: 3 },
  })
    .composite(layers)
    .jpeg({ quality: 88 })
    .toBuffer()

  return { image, rect: { left, top, width: bookWidth, height: bookHeight } }
}
