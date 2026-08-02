/**
 * PaddleOCR, as the first thing that reads a photo.
 *
 * Measured against the 20 back covers in the library whose barcode cannot be
 * read, which is exactly the set OCR exists for: it finds the printed ISBN on
 * 10 of them in about a second each, where the tesseract ladder finds 6 in
 * five and a half seconds. It hit every one tesseract did and four it did
 * not, so it goes first and tesseract stays behind it.
 *
 * Detection and recognition are separate models, so unlike tesseract it finds
 * the text regions itself rather than being handed a preprocessed variant and
 * asked to assume a layout. That is why the ladder of thresholds, crops and
 * page segmentation modes has no equivalent here: one pass does the lot.
 */

import { PaddleOcrService } from 'ppu-paddle-ocr'

export interface PaddleLine {
  text: string
  height: number
  words: number
}

export interface PaddleOutput {
  text: string
  lines: PaddleLine[]
}

let service: Promise<PaddleOcrService> | null = null

/**
 * Models are fetched once and cached on disk by the library. Started lazily so
 * the server does not wait on a download it may never need.
 */
function ready(): Promise<PaddleOcrService> {
  return (service ??= (async () => {
    const created = new PaddleOcrService()
    await created.initialize()
    return created
  })().catch((error) => {
    // Let the next call try again rather than caching the failure forever.
    service = null
    throw error
  }))
}

/** Lowest confidence worth passing on, matching the tesseract word filter. */
const MIN_CONFIDENCE = 0.4

export async function paddleOcr(input: Buffer): Promise<PaddleOutput | null> {
  try {
    const ocr = await ready()

    // A Node Buffer is neither an ArrayBuffer nor a canvas, which are the two
    // things this accepts, and .buffer alone would hand over pooled heap.
    const bytes = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength,
    ) as ArrayBuffer

    const result = await ocr.recognize(bytes)
    const raw = (result as { lines?: unknown }).lines
    const flat = Array.isArray(raw) ? raw.flat() : []

    return {
      text: result.text ?? '',
      lines: flat
        .filter((line): line is { text: string; box?: { height?: number }; confidence?: number } =>
          Boolean(line) && typeof (line as { text?: unknown }).text === 'string')
        .filter((line) => (line.confidence ?? 1) >= MIN_CONFIDENCE)
        .map((line) => ({
          text: line.text.replace(/\s+/g, ' ').trim(),
          height: line.box?.height ?? 0,
          // Used only to weigh how much of a line is real text; this reports
          // whole lines, so count the words in it.
          words: line.text.trim().split(/\s+/).filter(Boolean).length,
        })),
    }
  } catch (error) {
    console.error('[ocr] paddle failed:', (error as Error).message)
    return null
  }
}

/**
 * Fetch the models before anyone is waiting on them.
 *
 * They are downloaded once and cached on disk, but that once would otherwise
 * land on whoever scans first after a fresh install.
 */
export async function warmPaddle(): Promise<void> {
  try {
    await ready()
  } catch (error) {
    console.error('[ocr] paddle unavailable:', (error as Error).message)
  }
}

export async function shutdownPaddle(): Promise<void> {
  const running = service
  service = null
  await running?.then((s) => s.destroy()).catch(() => {})
}
