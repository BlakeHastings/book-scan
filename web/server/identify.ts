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
  extractIsbnsFromText, isbn13To10, resolveIsbnPair, type IsbnPair,
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
function barcodeVariants(input: Buffer): { name: string; build: () => Promise<GrayImage> }[] {
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
      build: () => toGray(framed(sharp(input)
        .resize({ width: 2000, withoutEnlargement: true, fit: 'inside' })
        .rotate(90))),
    },
    {
      name: 'rotated-270',
      build: () => toGray(framed(sharp(input)
        .resize({ width: 2000, withoutEnlargement: true, fit: 'inside' })
        .rotate(270))),
    },
  ]
}

export async function decodeBarcodes(input: Buffer): Promise<string[]> {
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

    const found: string[] = []
    for (const symbol of symbols) {
      const value = symbol.decode()?.trim() ?? ''
      // EAN-2 and EAN-5 are the price add-on strips, not the ISBN.
      if (value.length < 8) continue
      if (!found.includes(value)) found.push(value)
    }
    if (found.length) return found
  }

  return []
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

let generalWorker: Promise<Worker> | null = null
let digitsWorker: Promise<Worker> | null = null

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

/** A second worker restricted to digits. Changing parameters on a shared
 *  worker is stateful and leaks between calls, so this stays separate. */
function getDigitsWorker(): Promise<Worker> {
  return (digitsWorker ??= createWorker('eng', undefined, workerOptions()).then(async (worker) => {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789Xx- ' })
    return worker
  }))
}

export async function shutdownOcr(): Promise<void> {
  const workers = [generalWorker, digitsWorker]
  generalWorker = null
  digitsWorker = null
  await Promise.all(workers.map((w) => w?.then((worker) => worker.terminate())))
}

/**
 * CLAHE evens out lighting across a glossy cover far better than a plain
 * histogram stretch, which is exactly the choice recognize.py made.
 */
async function preprocessForOcr(input: Buffer): Promise<Buffer> {
  const metadata = await sharp(input).metadata()
  const width = metadata.width ?? 0

  let pipeline = sharp(input).flatten({ background: '#ffffff' }).grayscale()
  if (width > 1600) {
    pipeline = pipeline.resize({ width: 1600, fit: 'inside' })
  } else if (width > 0 && width < 900) {
    pipeline = pipeline.resize({ width: width * 2, fit: 'inside' })
  }

  return pipeline.clahe({ width: 8, height: 8, maxSlope: 3 }).png().toBuffer()
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

async function runOcr(input: Buffer, digitsOnly = false): Promise<OcrOutput> {
  try {
    const prepared = await preprocessForOcr(input)
    const worker = await (digitsOnly ? getDigitsWorker() : getGeneralWorker())
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

/** Barcode first, OCR second. Never throws. */
export async function identify(
  input: Buffer,
  options: IdentifyOptions = {},
): Promise<IdentifyResult> {
  const result: IdentifyResult = {
    isbn13: '', isbn10: '', source: '', barcodes: [], titleGuess: '', text: '',
    notes: [],
  }

  result.barcodes = await decodeBarcodes(input)
  const fromBarcode = fromBarcodes(result.barcodes)
  if (fromBarcode) {
    result.isbn13 = fromBarcode.isbn13
    result.isbn10 = fromBarcode.isbn10
    result.source = 'barcode'
    result.notes.push('ISBN read from the barcode.')
    if (!options.wantTitle) return result
  } else if (result.barcodes.length) {
    result.notes.push(
      'A barcode was found but it is not an ISBN. It is probably the price code.',
    )
  }

  if (options.ocrEnabled === false) return result

  const ocr = await runOcr(input)
  result.text = ocr.text
  if (options.wantTitle) result.titleGuess = pickTitle(ocr.lines)

  if (!result.isbn13) {
    let candidates = extractIsbnsFromText(ocr.text)

    if (!candidates.length) {
      // Second pass restricted to digits. Much better on a printed ISBN,
      // useless for anything else, so it only runs when the first pass failed.
      const digits = await runOcr(input, true)
      candidates = extractIsbnsFromText(digits.text)
      if (candidates.length) result.notes.push('ISBN read on a digits-only pass.')
    }

    const isbn13 = candidates[0]
    if (isbn13) {
      result.isbn13 = isbn13
      result.isbn10 = isbn13To10(isbn13)
      result.source = 'ocr'
      result.notes.push('No usable barcode, ISBN read by OCR.')
    }
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
