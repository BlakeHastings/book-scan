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

import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { scanGrayBuffer } from '@undecaf/zbar-wasm'
import { prepareZXingModule, readBarcodesFromImageFile } from 'zxing-wasm/reader'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import {
  extractIsbnCandidates, resolveIsbnPair,
  type IsbnPair,
} from '../shared/isbn'

export type IsbnSource = 'barcode' | 'ocr' | ''

export interface IdentifyResult {
  isbn13: string
  isbn10: string
  source: IsbnSource
  barcodes: string[]
  titleGuess: string
  /**
   * The largest readable lines on the cover, biggest first, with publisher
   * boilerplate removed.
   *
   * Kept separate from titleGuess because there is no reliable way to tell a
   * title from an author by geometry: on one cover the title is the largest
   * text, on the next it is the author's name. Showing both to the user beats
   * guessing wrong on their behalf.
   */
  coverLines: string[]
  /**
   * Every ISBN any OCR pass produced, best first.
   *
   * A single reading is not trustworthy on a worn label. OCR can garble a
   * digit inside the number and still land on a value that satisfies its
   * check digit, which is a confident, wrong book. Readings that more than
   * one pass agree on rank above ones only a single pass saw, and the caller
   * can settle the rest by asking a catalogue which of them actually exists.
   */
  isbnCandidates: string[]
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

/**
 * Smallest barcode geometry worth believing, in source pixels.
 *
 * zbar will occasionally report a symbol whose points are collinear, giving a
 * box of zero width. That is not a barcode location, and treating it as one
 * produced a one-pixel-wide crop that the upscale then blew up to 2000x42000
 * and killed the OCR worker outright.
 */
const MIN_BOX = 12

function boxFromPoints(points: unknown, scale: number) {
  if (!Array.isArray(points) || points.length < 2) return null
  const xs = points.map((p) => (p as { x: number }).x)
  const ys = points.map((p) => (p as { y: number }).y)

  // Undo the quiet-zone border, then the resize, to get back to source pixels.
  const toSource = (v: number) => (v - BORDER) / scale
  const box = {
    left: toSource(Math.min(...xs)),
    top: toSource(Math.min(...ys)),
    width: (Math.max(...xs) - Math.min(...xs)) / scale,
    height: (Math.max(...ys) - Math.min(...ys)) / scale,
  }

  if (!Number.isFinite(box.left) || !Number.isFinite(box.top)) return null
  if (box.width < MIN_BOX || box.height < MIN_BOX) return null
  return box
}

/**
 * zxing-cpp, compiled to WASM, does in one call what the ladder below does in
 * six passes: rotation, inversion, downscaling and a harder search are all its
 * own options, and it decodes the JPEG itself so nothing has to be
 * preprocessed first.
 *
 * Measured over the 53 back covers in the library, at the 2400px the phone
 * sends: it reads 32 of them in 158ms each, where the zbar ladder reads 27 in
 * 1306ms. So it goes first. zbar still runs when it finds nothing, because
 * the two fail on different images and between them they read 35.
 */
let zxingReady: Promise<unknown> | null = null

function readyZXing(): Promise<unknown> {
  // Node has no CDN to fetch the wasm from, so it is handed over directly.
  return (zxingReady ??= prepareZXingModule({
    overrides: {
      wasmBinary: readFileSync(
        createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm'),
      ),
    },
    fireImmediately: true,
  }))
}

async function decodeWithZXing(input: Buffer): Promise<DecodedBarcode[]> {
  try {
    await readyZXing()
    // toArrayBuffer copies the exact view: a Buffer's own .buffer is pooled
    // and would hand unrelated heap to the decoder.
    const results = await readBarcodesFromImageFile(new Blob([toArrayBuffer(input)]), {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      // Retail book codes only. Leaving QR and the rest on invites a sticker
      // or a promo code to answer instead of the book.
      formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
      // The five-digit price strip beside the ISBN is not part of it.
      eanAddOnSymbol: 'Ignore',
      maxNumberOfSymbols: 4,
    })

    return results
      .filter((r) => r.isValid && r.text.length >= 8)
      .map((r) => {
        const xs = Object.values(r.position).map((p) => p.x)
        const ys = Object.values(r.position).map((p) => p.y)
        const left = Math.min(...xs)
        const top = Math.min(...ys)
        const box = {
          left,
          top,
          width: Math.max(...xs) - left,
          height: Math.max(...ys) - top,
        }
        // Already in source pixels, unlike zbar's, which come back in the
        // coordinate space of whichever variant happened to decode.
        return {
          value: r.text.trim(),
          box: box.width >= MIN_BOX && box.height >= MIN_BOX ? box : null,
        }
      })
  } catch {
    return []
  }
}

export async function decodeBarcodesDetailed(
  input: Buffer,
  effort: 'fast' | 'thorough' = 'thorough',
): Promise<DecodedBarcode[]> {
  const quick = await decodeWithZXing(input)
  if (quick.length || effort === 'fast') return quick
  return decodeWithZBar(input)
}

/** The slow ladder, kept separate so it can be raced against OCR. */
async function decodeWithZBar(input: Buffer): Promise<DecodedBarcode[]> {

  const sourceWidth = (await sharp(input).metadata()).width ?? 0
  const variants = barcodeVariants(input)

  /*
   * Prepare the next variant's image while zbar is busy with this one.
   *
   * The two halves use different machinery, sharp on libvips threads and zbar
   * in WASM, and measured on a real back cover they cost about 1.4s and 2.4s
   * respectively when every variant has to be tried. Run strictly in turn that
   * is 3.8s; overlapped it is a little over the scanning alone.
   *
   * Only ever one variant ahead, so the common case where the first look
   * succeeds still does almost no wasted work, and only one zbar call is ever
   * in flight.
   */
  const prepare = (index: number) =>
    index < variants.length
      ? variants[index]!.build().catch(() => null)
      : Promise.resolve(null)

  let pending = prepare(0)

  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i]!
    const image = await pending
    pending = prepare(i + 1)

    if (!image) continue

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

export async function decodeBarcodes(
  input: Buffer,
  effort: 'fast' | 'thorough' = 'thorough',
): Promise<string[]> {
  return (await decodeBarcodesDetailed(input, effort)).map((b) => b.value)
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

/**
 * A pool of OCR workers, so the preprocessing ladder runs at once.
 *
 * tesseract.js workers handle exactly one job at a time and have no queue of
 * their own, which is documented and is why every OCR call used to be
 * serialised. A pool is the supported answer: each job takes a worker for
 * itself, sets the page segmentation mode it needs on that worker alone, and
 * gives it back.
 *
 * Four, which is what the tesseract.js docs suggest, and roughly the number
 * of rungs that matter. Each worker carries its own WASM heap, and that heap
 * only ever grows, so they are recycled after a while rather than left to
 * accumulate one large image's worth of memory forever.
 */
const POOL_SIZE = 4
const JOBS_BEFORE_RECYCLE = 400

interface PooledWorker {
  worker: Worker
  busy: boolean
  jobs: number
}

let pool: PooledWorker[] = []
let poolReady: Promise<void> | null = null
const waiting: (() => void)[] = []

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
function newWorker(): Promise<Worker> {
  return createWorker('eng', undefined, {
    ...workerOptions(),
    /*
     * Not optional. Without a handler here tesseract.js rethrows the failure
     * from inside a MessagePort callback, where nothing can catch it, and node
     * takes the whole process down. It has already rejected the pending
     * promise by this point, so the await sees an ordinary rejection and this
     * only has to stop the rethrow.
     */
    errorHandler: (data: unknown) => {
      console.error('[ocr] worker error:', data)
    },
  })
}

function startPool(): Promise<void> {
  return (poolReady ??= (async () => {
    const workers = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => newWorker()),
    )
    pool = workers.map((worker) => ({ worker, busy: false, jobs: 0 }))
  })())
}

/** Take a worker, use it alone, give it back. */
async function withWorker<T>(fn: (worker: Worker) => Promise<T>): Promise<T> {
  await startPool()

  let slot = pool.find((entry) => !entry.busy)
  while (!slot) {
    await new Promise<void>((resume) => waiting.push(resume))
    slot = pool.find((entry) => !entry.busy)
  }

  slot.busy = true
  try {
    return await fn(slot.worker)
  } finally {
    slot.jobs += 1

    // A worker's WASM heap grows with the largest image it has seen and never
    // shrinks, so a server left running for days would keep the high-water
    // mark of every one of them.
    if (slot.jobs >= JOBS_BEFORE_RECYCLE) {
      const old = slot.worker
      slot.jobs = 0
      try {
        slot.worker = await newWorker()
        void old.terminate()
      } catch {
        // Keep the old one rather than losing the slot entirely.
      }
    }

    slot.busy = false
    waiting.shift()?.()
  }
}

export async function shutdownOcr(): Promise<void> {
  const workers = pool
  pool = []
  poolReady = null
  await Promise.all(workers.map((entry) => entry.worker.terminate().catch(() => {})))
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
  /**
   * Page segmentation mode. Not one setting fits all: on a worn label AUTO
   * reads the blurb and skips the ISBN, while SINGLE_BLOCK reads the ISBN.
   * Measured, not guessed.
   */
  psm: PSM
}

/**
 * Upper bound on either side of anything handed to OCR.
 *
 * Every upscale below sets a width and lets height follow the aspect ratio.
 * For an ordinary photo that is fine; for a sliver it is not, and leptonica
 * refuses the result rather than failing softly. Bounding both sides means a
 * bad aspect ratio costs accuracy instead of the process.
 */
const MAX_OCR_SIDE = 5000

/** Generous region around the barcode: the printed ISBN sits right by it. */
export function regionAroundBarcode(
  input: Buffer,
  box: { left: number; top: number; width: number; height: number },
  meta: { width: number; height: number },
): Promise<Buffer> | null {
  // Wide on purpose. The ISBN line runs wider than the barcode above it, and
  // clipping its last character costs the check digit, which makes the whole
  // number unusable.
  const padX = box.width * 1.4
  const padY = box.height * 1.6

  const left = Math.max(0, Math.round(box.left - padX))
  const top = Math.max(0, Math.round(box.top - padY))
  const right = Math.min(meta.width, Math.round(box.left + box.width + padX))
  const bottom = Math.min(meta.height, Math.round(box.top + box.height + padY))

  const cropWidth = right - left
  const cropHeight = bottom - top

  // Clipping against the image edges can leave nothing usable, which is a
  // reason to fall back to the whole photo rather than to crop anyway.
  if (cropWidth < MIN_BOX || cropHeight < MIN_BOX) return null

  return sharp(input)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .grayscale()
    .resize({ width: 2000, height: MAX_OCR_SIDE, withoutEnlargement: false, fit: 'inside' })
    .normalise()
    .png()
    .toBuffer()
}

/**
 * The rungs that need to know where the barcode is.
 *
 * Split out from the rest because they are the only ones that have to wait
 * for the decoder: everything else can be read off the whole photo and so can
 * start immediately, in parallel with the barcode attempt.
 */
async function regionVariants(
  input: Buffer,
  barcodeBox: { left: number; top: number; width: number; height: number } | null,
): Promise<OcrVariant[]> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const variants: OcrVariant[] = []

  // A region is only offered when it survives the clipping. When it does not,
  // the whole-image variants below still run, so a bad box costs nothing.
  if (barcodeBox && width && height
      && regionAroundBarcode(input, barcodeBox, { width, height })) {
    const region = () =>
      regionAroundBarcode(input, barcodeBox, { width, height }) as Promise<Buffer>
    variants.push({
      // Hard threshold plus SINGLE_BLOCK is what reads a label carrying a
      // ghosted second impression of the same text, which defeats AUTO.
      name: 'barcode-region-block',
      psm: PSM.SINGLE_BLOCK,
      build: async () => sharp(await region()).threshold(160).png().toBuffer(),
    })
    variants.push({ name: 'barcode-region', psm: PSM.SPARSE_TEXT, build: region })
  }

  return variants
}

/** Everything that can be read without knowing where the barcode is. */
async function ocrVariants(
  input: Buffer,
  wantTitle = false,
): Promise<OcrVariant[]> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const variants: OcrVariant[] = []

  if (wantTitle && width && height) {
    // Title and author sit in the upper half of almost every cover. Running
    // the whole frame instead lets the artwork dominate and returns fragments
    // of the tagline, which is worse than reading nothing.
    const topHalf = () => sharp(input)
      .extract({ left: 0, top: Math.round(height * 0.06), width, height: Math.round(height * 0.46) })
      .grayscale()
      .resize({ width: 2400, height: MAX_OCR_SIDE, withoutEnlargement: false, fit: 'inside' })
      .normalise()

    variants.push({
      name: 'cover-top',
      psm: PSM.AUTO,
      build: () => topHalf().png().toBuffer(),
    })
    variants.push({
      name: 'cover-top-threshold',
      psm: PSM.AUTO,
      build: () => topHalf().threshold(120).png().toBuffer(),
    })
  }

  variants.push({
    name: 'wide-normalised',
    psm: PSM.AUTO,
    build: () => sharp(input).grayscale()
      .resize({ width: 2200, height: MAX_OCR_SIDE, withoutEnlargement: false, fit: 'inside' })
      .normalise().png().toBuffer(),
  })

  if (height) {
    // Publishers put the ISBN block low on the back cover.
    variants.push({
      name: 'lower-third',
      psm: PSM.SPARSE_TEXT,
      build: () => sharp(input)
        .extract({ left: 0, top: Math.round(height * 0.55), width, height: Math.round(height * 0.44) })
        .grayscale()
        .resize({ width: 2400, height: MAX_OCR_SIDE, withoutEnlargement: false, fit: 'inside' })
        .normalise().png().toBuffer(),
    })
  }

  variants.push({
    name: 'clahe',
    psm: PSM.AUTO,
    build: () => sharp(input).grayscale()
      .resize({ width: 1800, height: MAX_OCR_SIDE, withoutEnlargement: false, fit: 'inside' })
      .clahe({ width: 8, height: 8, maxSlope: 3 }).png().toBuffer(),
  })

  return variants
}

/** Run a set of rungs at once, each on its own worker. */
function runAll(variants: OcrVariant[]): Promise<OcrOutput[]> {
  return Promise.all(
    variants.map(async (variant) => {
      try {
        return await runOcr(await variant.build(), variant.psm)
      } catch {
        return { text: '', lines: [] } as OcrOutput
      }
    }),
  )
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

async function runOcr(prepared: Buffer, psm: PSM = PSM.AUTO): Promise<OcrOutput> {
  try {
    return await withWorker(async (worker) => {
    // Safe to set per call now: this worker is ours until we hand it back, so
    // no other pass can change the mode underneath this one.
    await worker.setParameters({ tessedit_pageseg_mode: psm })
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
    })
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
  // Series taglines. A real example that became a book's title:
  // "THE STORY OF THE CASTEEL FAMILY CONTINUES".
  /\bthe\s+story\s+of\b.*\bcontinu/i,
  /\bcontinues\.{0,3}$/i,
  /^the\s+extraordinary\b/i,
  /\bsequel\s+to\b/i,
  /\bmillion\s+copies\b/i,
  /^look\s+for\b/i,
  /^praise\s+for\b/i,
]

function isTitleNoise(text: string): boolean {
  return TITLE_NOISE.some((pattern) => pattern.test(text))
}

/**
 * Text that survived the noise filter but is still neither a name nor a
 * title: OCR debris from cover artwork.
 *
 * The failure this exists to stop is real. Running OCR over a whole
 * illustrated cover produced lines like "4] F", ": R 0" and "dy", and the
 * largest of them was promoted to the book's title.
 */
function looksLikeWords(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (letters.length < 3) return false
  // Mostly letters, not punctuation and stray digits.
  if (letters.length < text.replace(/\s/g, '').length * 0.6) return false
  // Artwork debris is usually consonant salad with no vowel in it.
  return /[aeiouAEIOU]/.test(letters)
}

/**
 * Pick the most title-looking line off a front cover. Titles are set larger
 * than everything else, so score by glyph height with a mild bonus for longer
 * lines, or a single stray capital beats a real multi-word title.
 */
function scoreLines(lines: OcrLine[]): { score: number; text: string }[] {
  return lines
    .filter((line) =>
      line.text.length >= 3 && !isTitleNoise(line.text) && looksLikeWords(line.text))
    .map((line) => ({ score: line.height * (1 + 0.1 * line.words), text: line.text }))
    .sort((a, b) => b.score - a.score)
}

/**
 * The biggest readable lines on a cover, largest first.
 *
 * Deliberately not labelled as title or author. On this shelf one cover has
 * the title largest and the next has the author largest, and guessing wrong
 * writes a person's name into the title field.
 */
export function pickCoverLines(lines: OcrLine[], limit = 3): string[] {
  const seen = new Set<string>()
  const picked: string[] = []
  for (const line of scoreLines(lines)) {
    // OCR tacks stray marks onto the ends of big cover type ("VCANDREWS |").
    const text = line.text.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.!?']+$/, '')
    const key = text.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    picked.push(text)
    if (picked.length >= limit) break
  }
  return picked
}

/**
 * Pick the most title-looking line off a front cover. Titles are set larger
 * than everything else, so score by glyph height with a mild bonus for longer
 * lines, or a single stray capital beats a real multi-word title.
 */
export function pickTitle(lines: OcrLine[]): string {
  return scoreLines(lines)[0]?.text ?? ''
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
  /**
   * How hard to look for a barcode.
   *
   * 'fast' is zxing alone: one pass, about 160ms, and it reads 32 of the 53
   * back covers in the library. 'thorough' adds the zbar ladder underneath,
   * which finds three more and costs 2.6 seconds to discover it has found
   * nothing, which is what a front cover always is.
   *
   * Worth it when the number is the answer, as in the ISBN dialog. Not worth
   * it when a recognisable cover will do, as at the shelf.
   */
  barcodeEffort?: 'fast' | 'thorough'
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
    isbn13: '', isbn10: '', source: '', barcodes: [], titleGuess: '',
    coverLines: [], isbnCandidates: [], text: '', notes: [],
  }

  /*
   * Look once quickly, then race everything else.
   *
   * zxing answers in about 160ms and reads most covers, so it goes alone
   * first: when it succeeds nothing else is started and the whole call costs
   * a fifth of a second. Racing OCR from the very beginning was tried and
   * made that common case worse, because the discarded OCR competes for the
   * same cores.
   *
   * Once it fails, though, everything left is worth starting at once. The
   * zbar ladder takes 2.6 seconds to admit it has nothing, and OCR used to
   * wait all of that out before beginning, on exactly the scans that needed
   * OCR most. Now they run together and the ladder is free.
   */
  const effort = options.barcodeEffort ?? 'thorough'
  const wantOcr = options.ocrEnabled !== false

  let decoded = await decodeWithZXing(input)
  let generalPasses: Promise<OcrOutput[]> | null = null

  if (!decoded.length && effort === 'thorough') {
    generalPasses = wantOcr ? ocrVariants(input, options.wantTitle).then(runAll) : null
    // Nothing may reject unobserved: an early return below abandons this.
    generalPasses?.catch(() => {})
    decoded = await decodeWithZBar(input)
  }

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

  /*
   * Every rung at once.
   *
   * These used to run in turn and stop early, which was the right trade when
   * one worker meant one pass at a time: a photo whose first rung read cleanly
   * paid for one pass, and only a hopeless one paid for all seven. With a pool
   * the ladder is no longer a queue, and the wall clock is the slowest rung
   * rather than the sum of them. Running rungs that turn out not to be needed
   * costs CPU nobody is waiting on.
   *
   * The results are still read in ladder order below. Which rung a reading
   * came from is what decides between two disagreeing readings, and that has
   * to stay a property of the ladder, not of which worker finished first.
   */
  // Ladder order: the region rungs read a label the decoder has already
  // located, so they come first and settle any disagreement.
  const passes = [
    ...await runAll(await regionVariants(input, barcodeBox)),
    ...await (generalPasses ?? ocrVariants(input, options.wantTitle).then(runAll)),
  ]

  // How many passes produced each reading. Agreement is the only cheap signal
  // that a number came off the page rather than out of OCR noise.
  const votes = new Map<string, number>()
  const order: string[] = []

  for (const ocr of passes) {
    result.text = result.text ? `${result.text}
${ocr.text}` : ocr.text
    if (options.wantTitle && !result.coverLines.length) {
      result.coverLines = pickCoverLines(ocr.lines)
      result.titleGuess = result.coverLines[0] ?? ''
    }

    for (const candidate of extractIsbnCandidates(ocr.text)) {
      if (!votes.has(candidate.isbn13)) order.push(candidate.isbn13)
      votes.set(candidate.isbn13, (votes.get(candidate.isbn13) ?? 0) + 1)
    }
  }

  // Ranked by which pass saw it first, NOT by how many passes agree.
  //
  // Agreement looked like the obvious signal and is a trap here. The rungs
  // are ordered best-first, and on a worn label two weaker passes will
  // happily agree with each other on the same misreading, outvoting the one
  // pass that read it correctly. Order beat votes on a real book.
  result.isbnCandidates = order

  const best = result.isbnCandidates[0]
  if (best) {
    const pair = resolveIsbnPair(best)
    result.isbn13 = pair.isbn13
    result.isbn10 = pair.isbn10
    result.source = 'ocr'
    result.notes.push(
      result.isbnCandidates.length > 1
        ? `ISBN read from the printed label. ${result.isbnCandidates.length} readings differed; the catalogue decides.`
        : 'ISBN read from the printed label.',
    )
  }

  if (!result.isbn13) {
    result.notes.push('No ISBN found in this photo.')
  }

  return result
}

/** Merge results from several photos, preferring a barcode over OCR. */
export function mergeIdentifications(results: IdentifyResult[]): IdentifyResult {
  const merged: IdentifyResult = {
    isbn13: '', isbn10: '', source: '', barcodes: [], titleGuess: '',
    coverLines: [], isbnCandidates: [], text: '', notes: [],
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
