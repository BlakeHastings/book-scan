/**
 * PaddleOCR, as the first thing that reads a photo: it recognises what
 * tesseract misses and runs faster, so tesseract stays behind it in the
 * ladder.
 *
 * Detection and recognition are separate models, so unlike tesseract it
 * finds the text regions itself rather than being handed a preprocessed
 * variant and asked to assume a layout. That is why the ladder of
 * thresholds, crops and page segmentation modes has no equivalent here: one
 * pass does the lot.
 */

import { PaddleOcrService } from 'ppu-paddle-ocr'
import sharp from 'sharp'

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
    const created = new PaddleOcrService({
      // onnxruntime's CPU arena keeps the largest set of tensors any photograph
      // needed for the life of the session, and Paddle's tensors scale with the
      // photograph. Without it they are freed after each run, for no measurable
      // loss of speed (#673).
      session: { enableCpuMemArena: false },
    })
    await created.initialize()
    return created
  })().catch((error) => {
    // Let the next call try again rather than caching the failure forever.
    service = null
    throw error
  }))
}

/**
 * The longest side Paddle is handed. Its detector never looks at more than 1920
 * pixels on a side, and recognition scales every line to 48 pixels high, so a
 * larger photograph reads no more text. It does cost more: the library decodes
 * and crops the photograph at whatever size it arrives, and a 12 MP phone
 * photograph took it to 2.5 GB above idle where this size takes about 0.9.
 */
export const PADDLE_MAX_SIDE = 2400

/**
 * The photograph at no more than `PADDLE_MAX_SIDE` on its longest side, as an
 * exact ArrayBuffer. A Node Buffer is neither an ArrayBuffer nor a canvas,
 * which are the two things Paddle accepts, and `.buffer` alone would hand over
 * pooled heap.
 */
async function forPaddle(input: Buffer): Promise<ArrayBuffer> {
  const { width = 0, height = 0 } = await sharp(input).metadata()
  const bytes = Math.max(width, height) > PADDLE_MAX_SIDE
    ? await sharp(input)
      .resize({ width: PADDLE_MAX_SIDE, height: PADDLE_MAX_SIDE, fit: 'inside' })
      .keepExif()
      .jpeg({ quality: 92 })
      .toBuffer()
    : input
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Lowest confidence worth passing on, matching the tesseract word filter. */
const MIN_CONFIDENCE = 0.4

export async function paddleOcr(input: Buffer): Promise<PaddleOutput | null> {
  try {
    const ocr = await ready()
    const result = await ocr.recognize(await forPaddle(input))
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
