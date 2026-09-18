/**
 * Measure how far apart two photographs of one book land, and how far apart
 * two photographs of different books land, so the cutoff a queue match uses
 * is a measurement rather than an inheritance.
 *
 * Run with: npx tsx scripts/queue-match-accuracy.ts <directory of photographs>
 *
 * It reads every file with `front` in its name. Point it at real
 * photographs: generated covers will not do here, since what makes this
 * comparison hard is the room around the book, and a generated cover has
 * none. Nothing here writes to the directory it is given.
 *
 * A real sample set will not contain the same book photographed twice, so
 * the second shot is modelled instead: the frame is scaled, shifted, turned,
 * relit, softened and re-encoded as JPEG, sized from the spread the detector
 * measures across different real books, an upper bound on how far one book
 * actually moves between two shots of itself. The negative side needs no
 * modelling: two different books, both really photographed, in the same
 * room, by the same person.
 */

import sharp from 'sharp'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { coverHash, distance } from '../server/imagehash'
import { CLOSE_LIMIT, MATCH_CUTOFF, QUEUE_LIMIT } from '../shared/confidence'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: npx tsx scripts/queue-match-accuracy.ts <directory of photographs>')
  process.exit(1)
}
const DRAWS = Number(process.argv[3] ?? 40)

const files = readdirSync(dir).filter((name) => name.includes('front')).sort()
if (!files.length) {
  console.error(`No file in ${dir} has "front" in its name.`)
  process.exit(1)
}
const shots = files.map((name) => ({ name, buffer: readFileSync(join(dir, name)) }))

/** Seeded, so any number quoted from a run of this can be reproduced. */
let seed = 0x2f6e2b1
function random(): number {
  seed ^= seed << 13; seed >>>= 0
  seed ^= seed >> 17
  seed ^= seed << 5; seed >>>= 0
  return seed / 0x100000000
}
function normal(): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random())
}

interface Jitter {
  dx: number
  dy: number
  scale: number
  angle: number
  brightness: number
  blur: number
}

function tier(shift: number, zoom: number, turn: number, light: number, soft: number) {
  return (): Jitter => ({
    dx: normal() * shift,
    // Larger than dx: the person is standing over a table, so their distance
    // from it varies more than their position across it.
    dy: normal() * shift * 1.4,
    scale: 1 + normal() * zoom,
    angle: normal() * turn,
    brightness: 1 + normal() * light,
    blur: Math.max(0, random() * soft),
  })
}

const TIERS = [
  ['steady  ', tier(0.008, 0.02, 1.5, 0.08, 1.0)],
  ['ordinary', tier(0.016, 0.05, 2.5, 0.12, 1.6)],
  ['careless', tier(0.032, 0.10, 5.0, 0.20, 2.5)],
] as const

/** The padding mirrors the surrounding texture rather than a flat colour, because a flat border is exactly what the hash's detector refuses. */
async function reshoot(buffer: Buffer, jitter: Jitter): Promise<Buffer> {
  const meta = await sharp(buffer).metadata()
  const width = meta.width ?? 1
  const height = meta.height ?? 1

  const scaledWidth = Math.max(2, Math.round(width * jitter.scale))
  const scaledHeight = Math.max(2, Math.round(height * jitter.scale))
  const scaled = await sharp(buffer)
    .resize(scaledWidth, scaledHeight, { fit: 'fill' })
    .toBuffer()

  const padX = Math.ceil(Math.abs(width - scaledWidth) / 2 + Math.abs(jitter.dx) * width) + 8
  const padY = Math.ceil(Math.abs(height - scaledHeight) / 2 + Math.abs(jitter.dy) * height) + 8
  const padded = await sharp(scaled)
    .extend({ top: padY, bottom: padY, left: padX, right: padX, extendWith: 'mirror' })
    .toBuffer()

  const paddedWidth = scaledWidth + 2 * padX
  const paddedHeight = scaledHeight + 2 * padY
  const clamp = (value: number, highest: number) => Math.min(Math.max(0, value), highest)

  let pipeline = sharp(padded).extract({
    left: clamp(Math.round((paddedWidth - width) / 2 + jitter.dx * width), paddedWidth - width),
    top: clamp(Math.round((paddedHeight - height) / 2 + jitter.dy * height), paddedHeight - height),
    width,
    height,
  })
  if (Math.abs(jitter.angle) > 0.05) pipeline = pipeline.rotate(jitter.angle, { background: '#202020' })
  pipeline = pipeline.modulate({ brightness: jitter.brightness })
  if (jitter.blur > 0.3) pipeline = pipeline.blur(jitter.blur)
  return pipeline.jpeg({ quality: 82 }).toBuffer()
}

function summarise(label: string, values: number[]): void {
  if (!values.length) {
    console.log(`${label}  nothing to measure`)
    return
  }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  console.log(
    `${label}  n=${values.length} min=${sorted[0]} p05=${at(0.05)} median=${at(0.5)} p95=${at(0.95)} max=${sorted.at(-1)} mean=${mean.toFixed(1)}`,
  )
}

const stored = new Map<string, string>()
for (const shot of shots) {
  try {
    stored.set(shot.name, await coverHash(shot.buffer))
  } catch (error) {
    console.log(`${shot.name}: refused, ${(error as Error).message}`)
  }
}
const names = [...stored.keys()]
console.log(`${names.length} of ${shots.length} photographs hashed\n`)

// The negative side, entirely real: no modelling anywhere in this block.
console.log('## two different books, both really photographed')
const realPairs: number[] = []
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    realPairs.push(distance(stored.get(names[i]!)!, stored.get(names[j]!)!))
  }
}
summarise('  ', realPairs)
console.log(
  `  ${realPairs.filter((d) => d <= MATCH_CUTOFF).length} of ${realPairs.length} sit at or inside MATCH_CUTOFF (${MATCH_CUTOFF})`,
)
console.log(
  `  ${realPairs.filter((d) => d <= CLOSE_LIMIT).length} of ${realPairs.length} sit at or inside CLOSE_LIMIT (${CLOSE_LIMIT})\n`,
)

const CUTOFFS = [4, 6, 8, 10, 12, 14, 16, 20, 24]
const caughtTotals = new Map(CUTOFFS.map((cut) => [cut, 0]))
const wrongTotals = new Map(CUTOFFS.map((cut) => [cut, 0]))
let caughtAll = 0
let wrongAll = 0

for (const [label, draw] of TIERS) {
  const same: number[] = []
  const wrong: number[] = []
  /** Per scan of a book that is not in the queue: how near the nearest is. */
  const nearestWrong: number[] = []

  for (const shot of shots) {
    if (!stored.has(shot.name)) continue
    for (let i = 0; i < DRAWS; i += 1) {
      let query: string
      try {
        query = await coverHash(await reshoot(shot.buffer, draw()))
      } catch {
        continue
      }
      same.push(distance(stored.get(shot.name)!, query))

      const others: number[] = []
      for (const other of names) {
        if (other === shot.name) continue
        const d = distance(query, stored.get(other)!)
        wrong.push(d)
        others.push(d)
      }
      if (others.length) nearestWrong.push(Math.min(...others))
    }
  }

  console.log(`## ${label.trim()} re-photograph`)
  summarise('  one book, twice ', same)
  summarise('  different books ', wrong)
  summarise('  nearest wrong   ', nearestWrong)
  console.log(`  cutoff  caught             wrong pairs             scans offered a wrong capture (queue of ${names.length - 1})`)
  for (const cut of CUTOFFS) {
    const caught = same.filter((d) => d <= cut).length
    const bad = wrong.filter((d) => d <= cut).length
    const scans = nearestWrong.filter((d) => d <= cut).length
    caughtTotals.set(cut, caughtTotals.get(cut)! + caught)
    wrongTotals.set(cut, wrongTotals.get(cut)! + bad)
    const mark = cut === QUEUE_LIMIT ? ' <- QUEUE_LIMIT' : ''
    console.log(
      `  <=${String(cut).padStart(2)}   ${String(caught).padStart(4)}/${same.length} (${((100 * caught) / same.length).toFixed(0).padStart(3)}%)    ${String(bad).padStart(5)}/${wrong.length} (${((100 * bad) / wrong.length).toFixed(2)}%)      ${String(scans).padStart(4)}/${nearestWrong.length} (${((100 * scans) / Math.max(1, nearestWrong.length)).toFixed(2)}%)${mark}`,
    )
  }
  caughtAll += same.length
  wrongAll += wrong.length
  console.log()
}

console.log('## every tier together, which is the number the cutoff is argued from')
console.log('  cutoff  caught             wrong pairs')
for (const cut of CUTOFFS) {
  const caught = caughtTotals.get(cut)!
  const bad = wrongTotals.get(cut)!
  const mark = cut === QUEUE_LIMIT ? ' <- QUEUE_LIMIT' : ''
  console.log(
    `  <=${String(cut).padStart(2)}   ${String(caught).padStart(4)}/${caughtAll} (${((100 * caught) / caughtAll).toFixed(0).padStart(3)}%)    ${String(bad).padStart(5)}/${wrongAll} (${((100 * bad) / wrongAll).toFixed(2)}%)${mark}`,
  )
}
