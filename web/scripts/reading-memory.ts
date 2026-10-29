/**
 * How much memory reading one photograph costs, stage by stage (#673).
 *
 * Run with: npx tsx scripts/reading-memory.ts [options]   (or npm run measure:reading --)
 *
 *   --photo <file>        a JPEG to read; default is a synthesised phone photograph
 *   --megapixels <n>      size of the synthesised photograph (default 12)
 *   --save <file>         also write the synthesised photograph here
 *   --no-embed            skip the DINOv2 stage (it downloads weights on first use)
 *   --soak <n>            then read n more photographs, to see whether memory settles
 *
 * Runs the same calls the capture queue makes for a capture with no readable
 * barcode: `identify` on the back, then on the front with a title pass, then
 * the crop and hash `derive` does, then the embedding a saved book gets, then
 * the scan route's quick reading. Before each stage the peak RSS is reset
 * (`/proc/self/clear_refs`), so each line is that stage's own high-water mark,
 * read from `VmHWM` afterwards. Linux only. Reads and writes nothing but the
 * photograph it is given and the caches under ~/.cache/bookscan.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { identify, shutdownOcr, warmOcr } from '../server/identify'
import { warmPaddle } from '../server/paddle'
import { cropBook } from '../server/bookcrop'
import { coverHash } from '../server/imagehash'
import { OnnxCoverEncoder } from '../infrastructure/capture/onnx-cover-encoder'
import { REAL_COVER_CACHE } from '../server/cover-matching/real-covers'

const MB = 1024 * 1024

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

function status(field: 'VmRSS' | 'VmHWM'): number {
  const line = readFileSync('/proc/self/status', 'utf8').split('\n').find((l) => l.startsWith(field))
  return Number(line?.match(/(\d+)/)?.[1] ?? 0) * 1024
}

function resetPeak(): void {
  // Writing 5 resets VmHWM to the current RSS (Linux 4.0 and later).
  writeFileSync('/proc/self/clear_refs', '5')
}

const mb = (bytes: number) => `${Math.round(bytes / MB)}`.padStart(6)

/**
 * A back cover photographed in front of a shelf: a slightly turned board of
 * paragraph text over a wall of real covers (from the cover-eval cache, when it
 * has been filled; otherwise noise), portrait, as a phone holds it. No barcode,
 * so every reader runs, and plenty of texture and small text for them to chew.
 */
async function phonePhoto(megapixels: number): Promise<Buffer> {
  const width = Math.round(Math.sqrt(megapixels * 1e6 * 3 / 4))
  const height = Math.round(width * 4 / 3)
  const coverW = Math.round(width * 0.7)
  const coverH = Math.round(height * 0.8)
  const font = Math.round(coverH / 55)
  const words = 'the quiet house at the end of the lane kept its secrets for a hundred years until one winter night a stranger arrived with a letter nobody could read'.split(' ')
  const lines: string[] = []
  for (let i = 0; i < 34; i += 1) {
    const start = (i * 7) % words.length
    lines.push([...words, ...words].slice(start, start + 8).join(' '))
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${coverW}" height="${coverH}">
    <rect width="100%" height="100%" fill="#e9dcc0"/>
    <text x="${coverW / 2}" y="${font * 4}" font-size="${font * 2.4}" text-anchor="middle" font-family="serif" font-weight="bold" fill="#3a1f10">PRAISE FOR THE LETTER</text>
    ${lines.map((line, i) => `<text x="${font * 3}" y="${font * 8 + i * font * 1.6}" font-size="${font}" font-family="serif" fill="#222">${line}</text>`).join('')}
    <text x="${font * 3}" y="${coverH - font * 3}" font-size="${font * 0.9}" font-family="sans-serif" fill="#444">Cover design by A. Printer   Fiction   $16.99</text>
  </svg>`
  const cover = await sharp(Buffer.from(svg)).rotate(1.5, { background: '#00000000' }).png().toBuffer()

  const tiles: OverlayOptions[] = []
  const files = existsSync(REAL_COVER_CACHE)
    ? readdirSync(REAL_COVER_CACHE).filter((f) => f.endsWith('.jpg')).sort()
    : []
  const tileW = Math.round(width / 6)
  const tileH = Math.round(tileW * 1.5)
  let n = 0
  for (let top = 0; top < height && files.length; top += tileH) {
    for (let left = 0; left < width; left += tileW) {
      const file = files[n++ % files.length]!
      const input = await sharp(join(REAL_COVER_CACHE, file)).resize(tileW, tileH, { fit: 'fill' }).toBuffer()
      tiles.push({ input, left, top })
    }
  }

  const wall = await sharp({
    create: { width, height, channels: 3, background: '#7b6a58', noise: { type: 'gaussian', mean: 110, sigma: 28 } },
  }).composite(tiles).jpeg().toBuffer()
  return sharp(wall)
    .composite([{ input: cover, gravity: 'centre' }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

interface Row { stage: string, ms: number, peak: number, after: number }
const rows: Row[] = []

async function stage(name: string, work: () => Promise<unknown>): Promise<void> {
  global.gc?.()
  resetPeak()
  const started = Date.now()
  await work()
  rows.push({ stage: name, ms: Date.now() - started, peak: status('VmHWM'), after: status('VmRSS') })
  console.log(`  ${name.padEnd(34)} peak ${mb(status('VmHWM'))} MB  after ${mb(status('VmRSS'))} MB  ${Date.now() - started} ms`)
}

async function main(): Promise<void> {
  const given = arg('photo')
  const photo = given ? readFileSync(given) : await phonePhoto(Number(arg('megapixels') ?? 12))
  const save = arg('save')
  if (save) writeFileSync(save, photo)
  const meta = await sharp(photo).metadata()
  console.log(`photograph: ${meta.width}x${meta.height}, ${(photo.length / MB).toFixed(1)} MB JPEG`)
  console.log(`start: rss ${mb(status('VmRSS'))} MB`)

  const encoder = process.argv.includes('--no-embed') ? null : new OnnxCoverEncoder()

  await stage('warm (paddle, tesseract, dinov2)', async () => {
    await warmPaddle()
    await warmOcr()
    if (encoder) await encoder.load()
  })
  const idle = status('VmRSS')

  await stage('identify back (queue, thorough)', () => identify(photo, { wantTitle: false }))
  // Different bytes for the front, as a real capture has: Paddle caches its
  // answer by the bytes it was given, and would otherwise not run at all.
  const front = await sharp(photo).jpeg({ quality: 90 }).toBuffer()
  await stage('identify front (queue, title)', () => identify(front, { wantTitle: true }))
  await stage('derive: crop', () => cropBook(photo))
  await stage('derive: hash', () => coverHash(photo))
  if (encoder) await stage('embed (dinov2)', () => encoder.embed(photo))
  const scanned = await sharp(photo).jpeg({ quality: 88 }).toBuffer()
  await stage('scan route (fast, paddle only)', () =>
    identify(scanned, { wantTitle: false, barcodeEffort: 'fast', paddleOnly: true }))

  const soak = Number(arg('soak') ?? 0)
  for (let i = 0; i < soak; i += 1) {
    // A different crop each time, so no reader has seen these exact bytes.
    const meta2 = await sharp(photo).metadata()
    const next = await sharp(photo)
      .extract({ left: i * 8, top: i * 8, width: meta2.width! - i * 8, height: meta2.height! - i * 8 })
      .jpeg({ quality: 92 }).toBuffer()
    await stage(`soak ${i + 1}: identify (queue, title)`, () => identify(next, { wantTitle: true }))
  }

  const worst = Math.max(...rows.slice(1).map((r) => r.peak))
  console.log(`\nidle after warm ${mb(idle)} MB; worst stage peak ${mb(worst)} MB, ${mb(worst - idle)} MB above idle`)
  await shutdownOcr()
}

main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
