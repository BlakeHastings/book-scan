/**
 * Reading an ISBN off a captured photo. Ported from bookscan/recognize.py,
 * which solved this properly, and kept in the same order of preference:
 * decode the barcode if one is visible, fall back to OCR of the printed ISBN,
 * and use OCR of the front cover as a title candidate.
 *
 * This runs on the server rather than in the phone. The phone is a camera and
 * a screen; the machine running the dev server has the CPU. It also keeps
 * several megabytes of WASM out of the mobile bundle.
 *
 * Why this succeeds where live scanning in the browser did not:
 *   - it decodes a full-resolution still, not a motion-blurred video frame
 *   - it retries with preprocessed variants instead of giving up on the first
 *     look, which is what rescues glossy and low-contrast covers
 *   - it uses zbar, the same engine pyzbar wraps, rather than ZXing
 *   - it falls back to OCR when there is no readable barcode at all
 */

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { scanGrayBuffer } from '@undecaf/zbar-wasm'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import {
  extractIsbnCandidates, resolveIsbnPair,
  type IsbnCandidate, type IsbnPair,
} from '../shared/isbn'

export type IsbnSource = 'barcode' | 'ocr' | ''

export interface IdentifyResult {
  isbn13: string
  isbn10: string
  source: IsbnSource
  barcodes: string[]
  titleGuess: string
  text: string
  notes: string[]
}

/**
 * A Node Buffer's `.buffer` is a *pooled* ArrayBuffer for small allocations,
 * so handing it straight to a WASM call can pass megabytes of unrelated heap
 * and silently decode nothing. Always copy out the exact view.
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
}

interface GrayImage {
  data: Buffer
  width: number
  height: number
}

async function toGray(pipeline: Sharp): Promise<GrayImage> {
  const { data, info } = await pipeline
    .flatten({ background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

// ---------------------------------------------------------------------------
// Barcode
// ---------------------------------------------------------------------------

/**
 * Variants tried in order, most likely to work first. Mirrors
 * decode_barcodes() in recognize.py.
 *
 * The white border on every variant is not cosmetic: zbar needs a quiet zone
 * around the symbol, and a barcode photographed right to the edge of frame
 * will not decode without one.
 */
interface BarcodeVariant {
  name: string
  /** Rotated variants cannot map a symbol box back to source axes. */
  rotated?: boolean
  build: () => Promise<GrayImage>
}

function barcodeVariants(input: Buffer): BarcodeVariant[] {
  const framed = (pipeline: Sharp) =>
    pipeline.extend({
      top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff',
    })

  return [
    {
      name: 'native',
      build: () => toGray(framed(sharp(input).resize({
        width: 2000, withoutEnlargement: true, fit: 'inside',
      }))),
    },
    {
      name: 'normalised',
      build: () => toGray(framed(sharp(input)
        .resize({ width: 2000, withoutEnlargement: true, fit: 'inside' })
        .normalise())),
    },
    {
      // Upscaling rescues a small or distant barcode.
      name: 'upscaled',
      build: () => toGray(framed(sharp(input).resize({
        width: 2600, withoutEnlargement: false, fit: 'inside',
      }).sharpen())),
    },
    {
      // Thresholding rescues low-contrast and glossy covers.
      name: 'threshold',
      build: () => toGray(framed(sharp(input)
        .resize({ width: 2000, withoutEnlargement: true, fit: 'inside' })
        .normalise()
        .threshold(128))),
    },
    {
      // A book photographed sideways still has a readable barcode once turned.
      name: 'rotated-90',
      rotated: true,
      build: () => toGray(framed(sharp(input)
        .resize({ width: 2000, withoutEnlargement: true, fit: 'inside' })
        .rotate(90))),
    },
    {
      name: 'rotated-270',
      rotated: true,
      build: () => toGray(framed(sharp(input)
        .resize({ width: 2000, withoutEnlargement: true, fit: 'inside' })
        .rotate(270))),
    },
  ]
}

export interface DecodedBarcode {
  value: string
  /** Bounding box in source pixels, when zbar reported symbol geometry. */
  box: { left: number; top: number; width: number; height: number } | null
}

/**
 * Where the barcode sits is worth as much as what it says. On an older book
 * the barcode is a retail UPC and the real ISBN is printed as text directly
 * beside it, so knowing the box lets OCR look in the right place instead of
 * at the whole photo.
 */
const BORDER = 24

function boxFromPoints(points: unknown, scale: number) {
  if (!Array.isArray(points) || points.length < 2) return null
  const xs = points.map((p) => (p as { x: number }).x)
  const ys = points.map((p) => (p as { y: number }).y)

  // Undo the quiet-zone border, then the resize, to get back to source pixels.
  const toSource = (v: number) => (v - BORDER) / scale
  return {
    left: toSource(Math.min(...xs)),
    top: toSource(Math.min(...ys)),
    width: (Math.max(...xs) - Math.min(...xs)) / scale,
    height: (Math.max(...ys) - Math.min(...ys)) / scale,
  }
}

export async function decodeBarcodesDetailed(input: Buffer): Promise<DecodedBarcode[]> {
  const sourceWidth = (await sharp(input).metadata()).width ?? 0

  for (const variant of barcodeVariants(input)) {
    let image: GrayImage
    try {
      image = await variant.build()
    } catch {
      continue
    }

    let symbols
    try {
      symbols = await scanGrayBuffer(toArrayBuffer(image.data), image.width, image.height)
    } catch {
      continue
    }

    const found: DecodedBarcode[] = []
    for (const symbol of symbols) {
      const value = symbol.decode()?.trim() ?? ''
      // EAN-2 and EAN-5 are the add-on strips, not the ISBN itself.
      if (value.length < 8) continue
      if (found.some((f) => f.value === value)) continue
      // Scale back out of the variant's coordinate space. Skip rotated
      // variants: their axes no longer match the source.
      const scale = sourceWidth ? (image.width - BORDER * 2) / sourceWidth : 0
      found.push({
        value,
        box: variant.rotated || !scale
          ? null
          : boxFromPoints((symbol as { points?: unknown }).points, scale),
      })
    }
    if (found.length) return found
  }

  return []
}

export async function decodeBarcodes(input: Buffer): Promise<string[]> {
  return (await decodeBarcodesDetailed(input)).map((b) => b.value)
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

let generalWorker: Promise<Worker> | null = null

/**
 * Where tesseract.js caches its language data. Left to itself it drops a 15 MB
 * eng.traineddata in the working directory, which is the repo root.
 */
const TESSDATA_CACHE = join(resolve(process.env.BOOKSCAN_DATA ?? 'data'), 'tessdata')

function workerOptions() {
  mkdirSync(TESSDATA_CACHE, { recursive: true })
  return { cachePath: TESSDATA_CACHE }
}

/**
 * Created on first use, so the server starts instantly and only downloads the
 * language data if OCR is actually needed.
 *
 * PSM matters more than it looks. tesseract.js defaults to SINGLE_BLOCK, which
 * assumes body text and throws away very large glyphs: on a front cover that
 * silently drops the title, which is the one line we actually want. AUTO finds
 * text at mixed sizes and costs nothing here.
 */
function getGeneralWorker(): Promise<Worker> {
  return (generalWorker ??= createWorker('eng', undefined, workerOptions()).then(async (worker) => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    return worker
  }))
}

export async function shutdownOcr(): Promise<void> {
  const worker = generalWorker
  generalWorker = null
  await worker?.then((w) => w.terminate())
}

/**
 * OCR preprocessing variants, tried until one yields an ISBN.
 *
 * Chosen by testing against a real failing photo (a 1986 paperback, dark
 * cover, shot on a dark table). Results on that image:
 *
 *   1600 wide + CLAHE   read nothing at all
 *   2200 wide + normalise   read the ISBN
 *   crop near the barcode, upscaled   read it most clearly
 *
 * CLAHE is kept last rather than dropped: it is what rescues a glossy cover
 * with uneven lighting, which normalise handles badly. Neither is universal,
 * which is exactly why this is a ladder and not a single choice.
 */
interface OcrVariant {
  name: string
  build: () => Promise<Buffer>
}

/** Generous region around the barcode: the printed ISBN sits right by it. */
function regionAroundBarcode(
  input: Buffer,
  box: { left: number; top: number; width: number; height: number },
  meta: { width: number; height: number },
): Promise<Buffer> {
  const padX = box.width * 0.6
  const padY = box.height * 1.2

  const left = Math.max(0, Math.round(box.left - padX))
  const top = Math.max(0, Math.round(box.top - padY))
  const right = Math.min(meta.width, Math.round(box.left + box.width + padX))
  const bottom = Math.min(meta.height, Math.round(box.top + box.height + padY))

  return sharp(input)
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .grayscale()
    .resize({ width: 2000, withoutEnlargement: false, fit: 'inside' })
    .normalise()
    .png()
    .toBuffer()
}

async function ocrVariants(
  input: Buffer,
  barcodeBox: { left: number; top: number; width: number; height: number } | null,
): Promise<OcrVariant[]> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const variants: OcrVariant[] = []

  if (barcodeBox && width && height) {
    variants.push({
      name: 'barcode-region',
      build: () => regionAroundBarcode(input, barcodeBox, { width, height }),
    })
  }

  variants.push({
    name: 'wide-normalised',
    build: () => sharp(input).grayscale()
      .resize({ width: 2200, withoutEnlargement: false, fit: 'inside' })
      .normalise().png().toBuffer(),
  })

  if (height) {
    // Publishers put the ISBN block low on the back cover.
    variants.push({
      name: 'lower-third',
      build: () => sharp(input)
        .extract({ left: 0, top: Math.round(height * 0.55), width, height: Math.round(height * 0.44) })
        .grayscale()
        .resize({ width: 2400, withoutEnlargement: false, fit: 'inside' })
        .normalise().png().toBuffer(),
    })
  }

  variants.push({
    name: 'clahe',
    build: () => sharp(input).grayscale()
      .resize({ width: 1800, withoutEnlargement: false, fit: 'inside' })
      .clahe({ width: 8, height: 8, maxSlope: 3 }).png().toBuffer(),
  })

  return variants
}

interface OcrLine {
  text: string
  height: number
  words: number
}

interface OcrOutput {
  text: string
  lines: OcrLine[]
}

async function runOcr(prepared: Buffer): Promise<OcrOutput> {
  try {
    const worker = await getGeneralWorker()
    const { data } = await worker.recognize(prepared, {}, { text: true, blocks: true })

    const lines: OcrLine[] = []
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const words = (line.words ?? []).filter((w) => (w.confidence ?? 0) >= 40)
          if (!words.length) continue
          lines.push({
            text: (line.text ?? '').replace(/\s+/g, ' ').trim(),
            height: (line.bbox?.y1 ?? 0) - (line.bbox?.y0 ?? 0),
            words: words.length,
          })
        }
      }
    }

    return { text: data.text ?? '', lines }
  } catch {
    return { text: '', lines: [] }
  }
}

/**
 * Lines that show up on nearly every cover and are never the title.
 *
 * The bestseller and New York Times patterns are deliberately unanchored:
 * these appear as fragments ("#1 NEW YORK TIMES BESTSELLER", "BESTSELLING
 * AUTHOR OF..."), and an anchored version misses all of them.
 */
const TITLE_NOISE: RegExp[] = [
  /^(a\s+novel|a\s+memoir|a\s+true\s+story|a\s+thriller|stories)$/i,
  /new\s+york\s+times/i,
  /bestsell(er|ing)/i,
  /^national\s+bestseller/i,
  /^international\s+bestseller/i,
  /^winner\s+of\b/i,
  /^author\s+of\b/i,
  /^with\s+a\s+new\b/i,
  /^now\s+a\s+major\b/i,
]

function isTitleNoise(text: string): boolean {
  return TITLE_NOISE.some((pattern) => pattern.test(text))
}

/**
 * Pick the most title-looking line off a front cover. Titles are set larger
 * than everything else, so score by glyph height with a mild bonus for longer
 * lines, or a single stray capital beats a real multi-word title.
 */
export function pickTitle(lines: OcrLine[]): string {
  const scored = lines
    .filter((line) =>
      line.text.length >= 3 && /[A-Za-z]/.test(line.text) && !isTitleNoise(line.text))
    .map((line) => ({ score: line.height * (1 + 0.1 * line.words), text: line.text }))

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.text ?? ''
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

/**
 * First decoded barcode that is actually a book.
 *
 * This must go through resolveIsbnPair rather than testing the check digit
 * directly: nearly every back cover carries a second barcode beside the ISBN
 * (an EAN-5 price add-on, or a plain EAN-13 retail code), and a plain EAN-13
 * satisfies the ISBN-13 checksum. Accepting one produces a confident lookup
 * for entirely the wrong book.
 */
function fromBarcodes(codes: string[]): IsbnPair | null {
  for (const code of codes) {
    const pair = resolveIsbnPair(code)
    if (pair.isbn13) return pair
  }
  return null
}

export interface IdentifyOptions {
  /** Front covers get a title guess; backs and spines do not need one. */
  wantTitle?: boolean
  ocrEnabled?: boolean
}

/**
 * One identification at a time, process-wide.
 *
 * A tesseract.js worker handles a single job at a time and zbar-wasm keeps a
 * module-level scanner, so two overlapping calls can interleave and corrupt
 * each other's results. That never happened with one person scanning; with
 * two phones pointed at the same server it happens immediately. Serialising
 * here covers both the queue worker and the live /api/identify path.
 */
let identifyChain: Promise<unknown> = Promise.resolve()

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const result = identifyChain.then(work, work)
  // Keep the chain alive even if this job rejects.
  identifyChain = result.then(() => undefined, () => undefined)
  return result
}

/** Barcode first, OCR second. Never throws. */
export function identify(
  input: Buffer,
  options: IdentifyOptions = {},
): Promise<IdentifyResult> {
  return serialise(() => identifyNow(input, options))
}

async function identifyNow(
  input: Buffer,
  options: IdentifyOptions = {},
): Promise<IdentifyResult> {
  const result: IdentifyResult = {
    isbn13: '', isbn10: '', source: '', barcodes: [], titleGuess: '', text: '',
    notes: [],
  }

  const decoded = await decodeBarcodesDetailed(input)
  result.barcodes = decoded.map((b) => b.value)
  const barcodeBox = decoded.find((b) => b.box)?.box ?? null
  const fromBarcode = fromBarcodes(result.barcodes)
  if (fromBarcode) {
    result.isbn13 = fromBarcode.isbn13
    result.isbn10 = fromBarcode.isbn10
    result.source = 'barcode'
    result.notes.push('ISBN read from the barcode.')
    if (!options.wantTitle) return result
  } else if (result.barcodes.length) {
    result.notes.push(
      'A barcode was found but it is not an ISBN. Older paperbacks carry a ' +
        'retail UPC instead, with the ISBN printed as text beside it.',
    )
  }

  if (options.ocrEnabled === false) return result

  // Work down the preprocessing ladder until something yields an ISBN. Each
  // rung is a full OCR pass, so stopping early matters.
  const variants = await ocrVariants(input, barcodeBox)
  let candidates: IsbnCandidate[] = []

  for (const variant of variants) {
    let ocr: OcrOutput
    try {
      ocr = await runOcr(await variant.build())
    } catch {
      continue
    }

    result.text = result.text ? `${result.text}
${ocr.text}` : ocr.text
    if (options.wantTitle && !result.titleGuess) {
      result.titleGuess = pickTitle(ocr.lines)
    }

    if (!result.isbn13) {
      candidates = extractIsbnCandidates(ocr.text)
      if (candidates.length) {
        const best = candidates[0]!
        result.isbn13 = best.isbn13
        result.isbn10 = best.isbn10
        result.source = 'ocr'
        result.notes.push(
          best.labelled
            ? `ISBN read from the printed label (${variant.name}).`
            : `ISBN read by OCR (${variant.name}).`,
        )
      }
    }

    // Stop once we have what we came for. The title guess only needs the
    // first readable pass.
    if (result.isbn13 && (!options.wantTitle || result.titleGuess)) break
  }

  if (!result.isbn13) {
    result.notes.push('No ISBN found in this photo.')
  }

  return result
}

/** Merge results from several photos, preferring a barcode over OCR. */
export function mergeIdentifications(results: IdentifyResult[]): IdentifyResult {
  const merged: IdentifyResult = {
    isbn13: '', isbn10: '', source: '', barcodes: [], titleGuess: '', text: '',
    notes: [],
  }

  for (const result of results) {
    merged.barcodes.push(...result.barcodes.filter((c) => !merged.barcodes.includes(c)))
    merged.titleGuess ||= result.titleGuess
    merged.text += result.text ? `${result.text}\n` : ''
    merged.notes.push(...result.notes.filter((n) => !merged.notes.includes(n)))

    const better = result.source === 'barcode' && merged.source !== 'barcode'
    if (result.isbn13 && (!merged.isbn13 || better)) {
      merged.isbn13 = result.isbn13
      merged.isbn10 = result.isbn10
      merged.source = result.source
    }
  }

  return merged
}
