/**
 * Synthetic book covers for tests. Generating them beats checking in binaries
 * and lets a test state exactly which condition it is exercising (glossy,
 * rotated, price add-on beside the ISBN, and so on).
 */

// The bare "bwip-js" specifier resolves to the browser build under bundler
// module resolution, which has no Buffer-returning toBuffer. Ask for node.
import bwipjs from 'bwip-js/node'
import sharp, { type OverlayOptions } from 'sharp'

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

  const svg = `<svg width="900" height="1250" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="1250" fill="#ffffff"/>
    <text x="60" y="120" font-family="Georgia" font-size="44" fill="#111">A NOVEL</text>
    <text x="60" y="210" font-family="Georgia" font-size="30" fill="#333">Praise for this remarkable book from the author.</text>
    <text x="60" y="280" font-family="Georgia" font-size="30" fill="#333">A sweeping story of sand, spice and succession.</text>
    ${printedIsbn ? `<text x="60" y="880" font-family="Helvetica" font-size="32" fill="#111">ISBN ${printIsbn10 ? printIsbn10.replace(/^(.)(...)(.....)(.)$/, '$1-$2-$3-$4') : hyphenated}</text>` : ''}
  </svg>`

  const composites: OverlayOptions[] = []
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

  // Render fully before rotating. sharp applies rotate BEFORE composite within
  // a single pipeline no matter which order you call them, so rotating inline
  // here silently pushed the barcode off the canvas.
  const composed = await sharp(Buffer.from(svg)).composite(composites).png().toBuffer()
  if (!rotate) return composed

  return sharp(composed).rotate(rotate, { background: '#ffffff' }).png().toBuffer()
}

/** A front cover: big title, smaller author and cover noise. */
export async function frontCover(title: string, author: string): Promise<Buffer> {
  const svg = `<svg width="900" height="1350" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="1350" fill="#ffffff"/>
    <text x="450" y="200" text-anchor="middle" font-family="Georgia" font-size="34" fill="#444">NEW YORK TIMES BESTSELLER</text>
    <text x="450" y="620" text-anchor="middle" font-family="Georgia" font-size="120" fill="#000">${title}</text>
    <text x="450" y="820" text-anchor="middle" font-family="Georgia" font-size="52" fill="#222">${author}</text>
    <text x="450" y="1250" text-anchor="middle" font-family="Georgia" font-size="30" fill="#555">A NOVEL</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
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
