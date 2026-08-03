/**
 * A generated book cover, written as a video file Chromium will play as a
 * camera.
 *
 * The end to end suite drives the real camera path: getUserMedia, a video
 * element, a canvas grab, an upload. Real hardware cannot be part of that and
 * still be deterministic, so Chromium is started with
 *
 *     --use-fake-device-for-media-stream
 *     --use-file-for-fake-video-capture=<this file>
 *
 * and every frame the page sees is this image. That is what makes the ISBN
 * under test known before the test runs rather than whatever happened to be in
 * front of a webcam.
 *
 * The cover itself comes from server/fixtures.ts, the same generator the unit
 * tests decode barcodes out of, so the picture the browser is shown is a
 * picture the server is already known to be able to read.
 *
 * Y4M rather than MJPEG for two reasons. It is uncompressed, so nothing sits
 * between the generated barcode and the frame the page receives. And it can be
 * written here with sharp, which this project already depends on, rather than
 * requiring ffmpeg on whatever machine runs the suite.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'

import { backCover, frontCover } from '../server/fixtures'

/** BT.601, studio swing. Chromium reads a Y4M back as limited range. */
function luma(r: number, g: number, b: number): number {
  return 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255
}

function chromaU(r: number, g: number, b: number): number {
  return 128 + (-37.797 * r - 74.203 * g + 112.0 * b) / 255
}

function chromaV(r: number, g: number, b: number): number {
  return 128 + (112.0 * r - 93.786 * g - 18.214 * b) / 255
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * One still, as a single-frame Y4M in I420.
 *
 * A single frame is enough: Chromium loops the file, so the page sees a
 * perfectly steady picture. That steadiness is the point. A real camera hands
 * the page a different, slightly blurrier frame every time, which is exactly
 * the source of flake this file exists to remove.
 */
export async function stillToY4m(png: Buffer, fps = 30): Promise<Buffer> {
  const meta = await sharp(png).metadata()

  // I420 stores chroma at half resolution in both directions, so an odd width
  // or height has no whole number of chroma samples. Trimming a row or column
  // is invisible and keeps the planes exact.
  const width = (meta.width ?? 0) & ~1
  const height = (meta.height ?? 0) & ~1
  if (!width || !height) throw new Error('The cover image has no dimensions.')

  const { data } = await sharp(png)
    .extract({ left: 0, top: 0, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const chromaWidth = width / 2
  const chromaHeight = height / 2
  const y = Buffer.alloc(width * height)
  const u = Buffer.alloc(chromaWidth * chromaHeight)
  const v = Buffer.alloc(chromaWidth * chromaHeight)

  /** Every index here is in range by construction; this satisfies the checker. */
  const channel = (index: number) => data[index] ?? 0

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const at = (row * width + col) * 3
      y[row * width + col] = clamp(
        luma(channel(at), channel(at + 1), channel(at + 2)),
      )
    }
  }

  // Chroma is the mean of each 2x2 block, which is what any encoder does and
  // what keeps a hard black-on-white barcode edge from acquiring a colour
  // fringe that the decoder would have to see past.
  for (let row = 0; row < chromaHeight; row += 1) {
    for (let col = 0; col < chromaWidth; col += 1) {
      let r = 0
      let g = 0
      let b = 0
      for (const offset of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
        const at = ((row * 2 + offset[0]) * width + (col * 2 + offset[1])) * 3
        r += channel(at)
        g += channel(at + 1)
        b += channel(at + 2)
      }
      const at = row * chromaWidth + col
      u[at] = clamp(chromaU(r / 4, g / 4, b / 4))
      v[at] = clamp(chromaV(r / 4, g / 4, b / 4))
    }
  }

  const header = Buffer.from(
    `YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`,
    'ascii',
  )
  return Buffer.concat([header, Buffer.from('FRAME\n', 'ascii'), y, u, v])
}

/** The back cover of a book with this ISBN: blurb, barcode, printed number. */
export async function backCoverVideo(isbn: string): Promise<Buffer> {
  return stillToY4m(await backCover(isbn))
}

/** The front cover, for a book being held up to be recognised. */
export async function frontCoverVideo(title: string, author: string): Promise<Buffer> {
  return stillToY4m(await frontCover(title, author))
}

const USAGE = [
  'Usage:',
  '  npm run e2e:fixture back <isbn> <out.y4m>',
  '  npm run e2e:fixture front <title> <author> <out.y4m>',
].join('\n')

/**
 * Command line, so the suite generates its fixtures through this package's own
 * toolchain rather than reaching into web/node_modules from outside it.
 *
 * Positional arguments, not flags: npm swallows anything that looks like
 * `--name value` after `npm run` and hands the script the bare values.
 */
async function main(): Promise<void> {
  const [kind, ...rest] = process.argv.slice(2)

  if (kind === 'back' && rest.length === 2) {
    await write(rest[1]!, await backCoverVideo(rest[0]!))
    return
  }
  if (kind === 'front' && rest.length === 3) {
    await write(rest[2]!, await frontCoverVideo(rest[0]!, rest[1]!))
    return
  }
  throw new Error(USAGE)
}

async function write(out: string, video: Buffer): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, video)
  console.log(`[fixture] ${out} (${video.length} bytes)`)
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
