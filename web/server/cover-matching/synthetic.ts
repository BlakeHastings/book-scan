/**
 * A labelled set for measuring cover matchers, made from nothing but a seed:
 * a catalogue of invented covers, and phone photographs of them.
 *
 * Generated rather than collected because covers are copyrighted and this
 * repository is public, and because the catalogue is somebody's real
 * collection that no test may read. The same seed gives the same set on one
 * machine; across machines glyph edges differ by a few grey levels (see the
 * note at the top of `server/fixtures.ts`), so a floor needs a margin.
 *
 * What makes it honest rather than easy:
 *  - Some books come in series that share one template and one palette and
 *    differ only in their words, which is where a whole-image likeness is
 *    weakest and where real shelves are hardest.
 *  - Every photograph is a perspective view of the cover at up to about 15
 *    degrees of rotation, sometimes cropped by the frame, on a textured
 *    background, with uneven light, a glare spot, blur, sensor noise and JPEG.
 *  - Some photographs are of books that are not in the catalogue at all, which
 *    is what somebody holding a new book does. Any confident answer to one of
 *    those is confidently wrong.
 */

import { fileURLToPath } from 'node:url'
import sharp, { type OverlayOptions } from 'sharp'
import type { CatalogueBook } from './matcher'

/** Text goes through sharp's own renderer with this file, never a font name in SVG, which fontconfig would resolve differently per machine. */
const FONT_FILE = fileURLToPath(new URL('../fixtures-assets/Gelasio-Regular.ttf', import.meta.url))

export const COVER_WIDTH = 400
export const COVER_HEIGHT = 600
export const PHOTO_WIDTH = 600
export const PHOTO_HEIGHT = 800

export interface Query {
  photo: Buffer
  /** The catalogue id this is a photograph of, or null when the book is not catalogued. */
  truth: string | null
  /** Which generated book was photographed, catalogued or not, for reading a failure back. */
  book: string
}

export interface CoverSet {
  catalogue: CatalogueBook[]
  queries: Query[]
}

export interface SetOptions {
  seed: number
  /** Books in the catalogue. */
  books: number
  /** Photographs taken of each catalogued book. */
  photosPerBook: number
  /** How rough the photographs are, 0 to 1; see `photograph`. Defaults to 1. */
  severity?: number
  /** Books photographed that are not in the catalogue, one photograph each. */
  absent: number
  /**
   * Contained-title families added on top (#669): a series whose first title
   * sits inside the second ("Dune" and "Dune Messiah"), one volume
   * catalogued and the other only held up. They alternate which volume is
   * catalogued, so the shelf holds the short title against a photograph of
   * the long one, and the long title against a photograph of the short one.
   * Defaults to 2; 0 gives the set as it was before #669.
   */
  contained?: number
}

export type Random = () => number

/** xorshift32, so a set is a function of its seed and nothing else. */
export function seeded(seed: number): Random {
  let state = (seed >>> 0) || 0x9e3779b9
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

const between = (random: Random, low: number, high: number) => low + random() * (high - low)
const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)]!

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

const ADJECTIVES = [
  'Silent', 'Broken', 'Hidden', 'Last', 'Burning', 'Winter', 'Golden', 'Hollow', 'Distant', 'Iron',
  'Glass', 'Crimson', 'Quiet', 'Endless', 'Forgotten', 'Northern', 'Salt', 'Paper', 'Bright', 'Long',
]
const NOUNS = [
  'River', 'Kingdom', 'Garden', 'Orchard', 'Lighthouse', 'Archive', 'Harbour', 'Machine', 'Mountain',
  'Library', 'Station', 'Empire', 'Daughter', 'Engine', 'Island', 'Cartographer', 'Signal', 'Field',
  'Atlas', 'Weather',
]
const FIRST = [
  'Ada', 'Tomas', 'Mira', 'Owen', 'Lena', 'Rafael', 'Ingrid', 'Kofi', 'Hana', 'Pavel', 'Clara', 'Idris',
  'Noor', 'Felix', 'Saoirse', 'Jun',
]
const LAST = [
  'Whitlock', 'Okafor', 'Lindqvist', 'Moreau', 'Castellano', 'Ashdown', 'Nakamura', 'Brennan', 'Volkov',
  'Adeyemi', 'Hartley', 'Quill', 'Sorensen', 'Delacroix', 'Mbeki', 'Farrow',
]

type Layout = 'field' | 'gradient' | 'split' | 'shapes' | 'frame' | 'stripes'

/** Everything about how a cover looks except its words. A series shares one. */
interface Design {
  layout: Layout
  hue: number
  paper: string
  accent: string
  ink: string
  /** Where the title box sits, as a fraction of the height. */
  titleAt: number
  authorAt: number
  upper: boolean
  italic: boolean
  /** Shapes are part of a design, so a series repeats them. */
  shapes: { kind: 'circle' | 'rect' | 'triangle', x: number, y: number, size: number, colour: string }[]
}

function design(random: Random): Design {
  const hue = Math.floor(random() * 360)
  const dark = random() < 0.45
  const paper = hsl(hue, between(random, 0.2, 0.75), dark ? between(random, 0.12, 0.3) : between(random, 0.7, 0.92))
  const accent = hsl((hue + between(random, 90, 270)) % 360, between(random, 0.4, 0.9), between(random, 0.35, 0.65))
  const ink = dark ? hsl(hue, 0.15, between(random, 0.85, 0.97)) : hsl(hue, 0.3, between(random, 0.05, 0.2))
  const titleTop = random() < 0.6
  const shapes = Array.from({ length: Math.floor(between(random, 1, 6)) }, () => ({
    kind: pick(random, ['circle', 'rect', 'triangle'] as const),
    x: random(),
    y: random(),
    size: between(random, 0.08, 0.45),
    colour: hsl((hue + between(random, 0, 360)) % 360, between(random, 0.3, 0.9), between(random, 0.3, 0.75)),
  }))
  return {
    layout: pick(random, ['field', 'gradient', 'split', 'shapes', 'frame', 'stripes'] as const),
    hue,
    paper,
    accent,
    ink,
    titleAt: titleTop ? between(random, 0.06, 0.25) : between(random, 0.4, 0.6),
    authorAt: titleTop ? between(random, 0.78, 0.88) : between(random, 0.06, 0.16),
    upper: random() < 0.4,
    italic: random() < 0.25,
    shapes,
  }
}

function artwork(look: Design): string {
  const w = COVER_WIDTH
  const h = COVER_HEIGHT
  const body: string[] = []
  switch (look.layout) {
    case 'field':
      body.push(`<rect width="${w}" height="${h}" fill="${look.paper}"/>`)
      body.push(`<rect y="${h * 0.62}" width="${w}" height="${h * 0.08}" fill="${look.accent}"/>`)
      break
    case 'gradient':
      body.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stop-color="${look.paper}"/><stop offset="1" stop-color="${look.accent}"/></linearGradient></defs>`)
      body.push(`<rect width="${w}" height="${h}" fill="url(#g)"/>`)
      break
    case 'split':
      body.push(`<rect width="${w}" height="${h}" fill="${look.paper}"/>`)
      body.push(`<rect x="${w * 0.55}" width="${w * 0.45}" height="${h}" fill="${look.accent}"/>`)
      break
    case 'frame':
      body.push(`<rect width="${w}" height="${h}" fill="${look.accent}"/>`)
      body.push(`<rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="${look.paper}"/>`)
      break
    case 'stripes':
      body.push(`<rect width="${w}" height="${h}" fill="${look.paper}"/>`)
      for (let i = 0; i < 6; i += 1) {
        body.push(`<rect x="${(i * w) / 6}" width="${w / 18}" height="${h}" fill="${look.accent}" opacity="0.6"/>`)
      }
      break
    case 'shapes':
      body.push(`<rect width="${w}" height="${h}" fill="${look.paper}"/>`)
      break
  }
  for (const shape of look.shapes) {
    const x = shape.x * w
    const y = shape.y * h
    const s = shape.size * w
    if (shape.kind === 'circle') body.push(`<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${shape.colour}" opacity="0.85"/>`)
    if (shape.kind === 'rect') body.push(`<rect x="${x - s / 2}" y="${y - s / 3}" width="${s}" height="${(s * 2) / 3}" fill="${shape.colour}" opacity="0.85"/>`)
    if (shape.kind === 'triangle') body.push(`<polygon points="${x},${y - s / 2} ${x + s / 2},${y + s / 2} ${x - s / 2},${y + s / 2}" fill="${shape.colour}" opacity="0.85"/>`)
  }
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${body.join('')}</svg>`
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function words(text: string, ink: string, box: { width: number, height: number }, italic: boolean): Promise<Buffer> {
  const marked = `<span foreground="${ink}">${italic ? `<i>${escape(text)}</i>` : escape(text)}</span>`
  return sharp({
    text: { text: marked, font: 'Gelasio', fontfile: FONT_FILE, rgba: true, align: 'centre', ...box },
  }).png().toBuffer()
}

async function placed(image: Buffer, top: number): Promise<OverlayOptions> {
  const { width = 0 } = await sharp(image).metadata()
  return { input: image, top: Math.round(top), left: Math.round((COVER_WIDTH - width) / 2) }
}

export interface Book {
  title: string
  author: string
  look: Design
}

/** A cover, as the catalogue would hold it: flat artwork, JPEG. */
export async function renderCover(book: Book): Promise<Buffer> {
  const { look } = book
  const title = look.upper ? book.title.toUpperCase() : book.title
  const titleBox = { width: COVER_WIDTH - 50, height: Math.round(COVER_HEIGHT * 0.2) }
  const authorBox = { width: COVER_WIDTH - 90, height: Math.round(COVER_HEIGHT * 0.06) }

  return sharp(Buffer.from(artwork(look)))
    .composite([
      await placed(await words(title, look.ink, titleBox, look.italic), look.titleAt * COVER_HEIGHT),
      await placed(await words(book.author, look.ink, authorBox, false), look.authorAt * COVER_HEIGHT),
    ])
    .jpeg({ quality: 90 })
    .toBuffer()
}

/**
 * The books of a set, catalogued or not. About a quarter of them come in
 * series of three to five sharing a design, titled like real series are: one
 * phrase, a different second half.
 */
export function inventBooks(random: Random, count: number): Book[] {
  const books: Book[] = []
  const used = new Set<string>()
  const fresh = (make: () => string) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const title = make()
      if (!used.has(title)) {
        used.add(title)
        return title
      }
    }
    const title = `${make()} ${used.size}`
    used.add(title)
    return title
  }
  const author = () => `${pick(random, FIRST)} ${pick(random, LAST)}`

  while (books.length < count) {
    if (random() < 0.08) {
      const look = design(random)
      const by = author()
      const series = `The ${pick(random, NOUNS)} ${pick(random, ['Cycle', 'Chronicles', 'Saga', 'Quartet'])}`
      const size = Math.min(count - books.length, Math.floor(between(random, 3, 6)))
      for (let n = 0; n < size; n += 1) {
        books.push({
          title: fresh(() => `${series}: The ${pick(random, ADJECTIVES)} ${pick(random, NOUNS)}`),
          author: by,
          look,
        })
      }
    } else {
      books.push({
        title: fresh(() => random() < 0.5
          ? `The ${pick(random, ADJECTIVES)} ${pick(random, NOUNS)}`
          : `${pick(random, NOUNS)} of ${pick(random, ADJECTIVES)} ${pick(random, NOUNS)}s`),
        author: author(),
        look: design(random),
      })
    }
  }
  return books
}

type Point = [number, number]

/**
 * The 3x3 projective map taking each `from` corner to its `to` corner, as the
 * eight free entries, by solving the textbook 8x8 system directly.
 */
function homography(from: Point[], to: Point[]): number[] {
  const rows: number[][] = []
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = from[i]!
    const [u, v] = to[i]!
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let col = 0; col < 8; col += 1) {
    let best = col
    for (let r = col + 1; r < 8; r += 1) if (Math.abs(rows[r]![col]!) > Math.abs(rows[best]![col]!)) best = r
    ;[rows[col], rows[best]] = [rows[best]!, rows[col]!]
    for (let r = 0; r < 8; r += 1) {
      if (r === col) continue
      const factor = rows[r]![col]! / rows[col]![col]!
      for (let c = col; c < 9; c += 1) rows[r]![c]! -= factor * rows[col]![c]!
    }
  }
  return rows.map((row, i) => row[8]! / row[i]!)
}

type Ground = 'wood' | 'carpet' | 'plain' | 'cloth'

function ground(random: Random, style: Ground, out: Float32Array): void {
  const base = [between(random, 60, 200), between(random, 50, 190), between(random, 40, 180)]
  for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
    for (let x = 0; x < PHOTO_WIDTH; x += 1) {
      let shade = 0
      if (style === 'wood') shade = Math.sin(y / 9 + Math.sin(x / 60) * 2) * 14 + ((y % 140) < 3 ? -40 : 0)
      if (style === 'carpet') shade = (random() - 0.5) * 50
      if (style === 'cloth') shade = ((Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? 18 : -18) + (random() - 0.5) * 12
      if (style === 'plain') shade = (random() - 0.5) * 6
      const i = (y * PHOTO_WIDTH + x) * 3
      out[i] = base[0]! + shade
      out[i + 1] = base[1]! + shade
      out[i + 2] = base[2]! + shade
    }
  }
}

/**
 * A phone photograph of `cover`: the cover is projected through a random
 * perspective onto a textured ground, then lit unevenly, glared, noised,
 * blurred and JPEG-encoded. Every draw comes from `random`.
 *
 * `severity` scales everything geometric and photographic at once: 1 is a
 * careless one-handed shot (up to 15 degrees, a strong keystone, the frame
 * cutting the book), 0 is the cover square in the middle of the frame with
 * nothing but the ground around it.
 */
export async function photograph(cover: Buffer, random: Random, severity = 1): Promise<Buffer> {
  const source = await sharp(cover).resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  const spread = (limit: number) => between(random, -limit, limit) * severity

  // The book fills 60 to 100 per cent of the frame's height, so at the large
  // end the frame cuts some of it off.
  const height = PHOTO_HEIGHT * (0.8 + spread(0.2))
  const width = height * (COVER_WIDTH / COVER_HEIGHT)
  const centreX = PHOTO_WIDTH / 2 + spread(0.08) * PHOTO_WIDTH
  const centreY = PHOTO_HEIGHT / 2 + spread(0.08) * PHOTO_HEIGHT
  const turn = (spread(15) * Math.PI) / 180
  // A tilt towards or away from the camera shortens one edge: keystone.
  const keystone = spread(0.12)
  const sideways = spread(0.1)
  const square: Point[] = [
    [-0.5 * (1 - keystone), -0.5 * (1 - sideways)],
    [0.5 * (1 - keystone), -0.5 * (1 + sideways)],
    [0.5 * (1 + keystone), 0.5 * (1 + sideways)],
    [-0.5 * (1 + keystone), 0.5 * (1 - sideways)],
  ]
  const corners: Point[] = square.map(([u, v]) => {
    const x = u * width + spread(0.03) * width
    const y = v * height + spread(0.03) * height
    return [
      centreX + x * Math.cos(turn) - y * Math.sin(turn),
      centreY + x * Math.sin(turn) + y * Math.cos(turn),
    ]
  })
  const toCover = homography(corners, [[0, 0], [COVER_WIDTH, 0], [COVER_WIDTH, COVER_HEIGHT], [0, COVER_HEIGHT]])
  const [a, b, c, d, e, f, g, h] = toCover as [number, number, number, number, number, number, number, number]

  const pixels = new Float32Array(PHOTO_WIDTH * PHOTO_HEIGHT * 3)
  ground(random, pick(random, ['wood', 'carpet', 'plain', 'cloth'] as const), pixels)

  // Light falling off across the frame along a random direction, one bright
  // reflection off the laminate somewhere on it, a colour cast and an
  // exposure that is not quite right.
  const grain = 1 + random() * 8 * severity
  const fall = random() * Math.PI * 2
  const fallX = Math.cos(fall) / PHOTO_WIDTH
  const fallY = Math.sin(fall) / PHOTO_HEIGHT
  const shadow = random() * 0.45 * severity
  const glareX = random() * PHOTO_WIDTH
  const glareY = random() * PHOTO_HEIGHT
  const glareR = between(random, 0.08, 0.3) * PHOTO_WIDTH
  const glareAlpha = between(random, 0.15, 0.75) * severity
  const exposure = 1 + spread(0.2)
  const warmth = spread(0.08)
  const cast = [exposure * (1 + warmth), exposure, exposure * (1 - warmth)]

  for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
    for (let x = 0; x < PHOTO_WIDTH; x += 1) {
      const w = g * x + h * y + 1
      const u = (a * x + b * y + c) / w
      const v = (d * x + e * y + f) / w
      const i = (y * PHOTO_WIDTH + x) * 3
      if (u >= 0 && v >= 0 && u < COVER_WIDTH - 1 && v < COVER_HEIGHT - 1) {
        // Bilinear, so the edges of type stay soft the way a lens leaves them.
        const x0 = Math.floor(u)
        const y0 = Math.floor(v)
        const fx = u - x0
        const fy = v - y0
        const top = (y0 * COVER_WIDTH + x0) * 3
        const bottom = top + COVER_WIDTH * 3
        for (let ch = 0; ch < 3; ch += 1) {
          pixels[i + ch] = (source[top + ch]! * (1 - fx) + source[top + 3 + ch]! * fx) * (1 - fy)
            + (source[bottom + ch]! * (1 - fx) + source[bottom + 3 + ch]! * fx) * fy
        }
      }

      const along = 0.5 + (x - PHOTO_WIDTH / 2) * fallX + (y - PHOTO_HEIGHT / 2) * fallY
      const shade = 1 - shadow * Math.min(1, Math.max(0, along))
      const gx = (x - glareX) / glareR
      const gy = (y - glareY) / (glareR * 0.6)
      const glare = glareAlpha * Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy))
      // Gaussian-ish sensor noise: the sum of three uniforms.
      const noise = (random() + random() + random() - 1.5) * grain
      for (let ch = 0; ch < 3; ch += 1) {
        const lit = pixels[i + ch]! * shade * cast[ch]!
        pixels[i + ch] = lit * (1 - glare) + 255 * glare + noise
      }
    }
  }
  // The typed-array constructor clamps and rounds in native code; `from` would
  // walk the pixels one by one through an iterator.
  const clamped = new Uint8ClampedArray(pixels)
  const raw = Buffer.from(clamped.buffer, clamped.byteOffset, clamped.byteLength)

  let shot = sharp(raw, { raw: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT, channels: 3 } })
  const blur = random() * 1.8 * severity
  if (blur >= 0.3) shot = shot.blur(blur)
  return shot.jpeg({ quality: Math.round(90 - random() * 40 * severity) }).toBuffer()
}

/** A book with a cover, before anybody has decided whether it is catalogued. */
export interface Covered {
  title: string
  author: string
  cover: Buffer
}

/**
 * Photograph a list of covered books: `absent` of them, drawn from across the
 * list, are held up but left out of the catalogue, and every other one is
 * catalogued and photographed `photosPerBook` times. Catalogued books get ids
 * `b0`, `b1`, ... by their position in `books`.
 */
export async function photographed(
  books: readonly Covered[],
  options: Omit<SetOptions, 'books'>,
  random: Random = seeded(options.seed),
): Promise<CoverSet> {
  // From across the list rather than its tail, so that a book whose series
  // siblings are catalogued is among the things held up.
  const order = books.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const absent = new Set(order.slice(0, options.absent))

  const catalogue: CatalogueBook[] = []
  const queries: Query[] = []
  for (let i = 0; i < books.length; i += 1) {
    const { title, author, cover } = books[i]!
    if (absent.has(i)) {
      queries.push({ photo: await photograph(cover, random, options.severity), truth: null, book: title })
      continue
    }
    const id = `b${i}`
    catalogue.push({ id, title, author, cover })
    for (let n = 0; n < options.photosPerBook; n += 1) {
      queries.push({ photo: await photograph(cover, random, options.severity), truth: id, book: title })
    }
  }
  return { catalogue, queries }
}

/** The second half a later volume adds to a first volume's whole title. */
const SEQUELS = ['Rising', 'Returns', 'Reborn', 'Messiah', 'Awakening', 'Unbound']

/**
 * Families whose first title is contained in the second, every one of them
 * a series sibling no other check here can see: the words of the short title
 * are all printed on the long one's cover, and both share one design and one
 * author. From a random stream of their own, so adding them leaves every
 * other book and photograph of a seed exactly as it was.
 */
async function containedFamilies(options: SetOptions, taken: ReadonlySet<string>): Promise<CoverSet> {
  const random = seeded(options.seed * 7919 + 17)
  const catalogue: CatalogueBook[] = []
  const queries: Query[] = []
  for (let family = 0; family < (options.contained ?? 2); family += 1) {
    let first = ''
    do first = `The ${pick(random, ADJECTIVES)} ${pick(random, NOUNS)}`
    while (taken.has(first))
    const second = `${first} ${pick(random, SEQUELS)}`
    const look = design(random)
    const author = `${pick(random, FIRST)} ${pick(random, LAST)}`
    const [shelved, held] = family % 2 === 0 ? [first, second] : [second, first]
    const id = `c${family}`
    const shelvedCover = await renderCover({ title: shelved, author, look })
    catalogue.push({ id, title: shelved, author, cover: shelvedCover })
    for (let n = 0; n < options.photosPerBook; n += 1) {
      queries.push({ photo: await photograph(shelvedCover, random, options.severity), truth: id, book: shelved })
    }
    const heldCover = await renderCover({ title: held, author, look })
    queries.push({ photo: await photograph(heldCover, random, options.severity), truth: null, book: held })
  }
  return { catalogue, queries }
}

/** The whole synthetic set: invented books, their covers, and photographs of them. */
export async function coverSet(options: SetOptions): Promise<CoverSet> {
  const random = seeded(options.seed)
  const books: Covered[] = []
  for (const book of inventBooks(random, options.books + options.absent)) {
    books.push({ title: book.title, author: book.author, cover: await renderCover(book) })
  }
  const set = await photographed(books, options, random)
  const families = await containedFamilies(options, new Set(books.map((book) => book.title)))
  return { catalogue: [...set.catalogue, ...families.catalogue], queries: [...set.queries, ...families.queries] }
}
