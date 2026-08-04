/**
 * Finding the book in a photograph, after it has been taken.
 *
 * This repository already tried book detection once and removed it (the Python
 * `bookscan/detect.py`, deleted in 6f1ff08) because it "fired on the wrong
 * thing often enough to be slower than just pressing a key". That was a live
 * shutter trigger: it had to be right within a frame, and being wrong meant
 * taking the wrong photograph.
 *
 * This is a different job with the same geometry. It runs after the shutter,
 * on a file already safely on disk, it may take a second, it can decline, and
 * a person can look at the result. So the failure that sank the live version
 * is survivable here, as long as declining is cheap and a wrong crop is rare.
 * Everything below is arranged around that: it would rather find nothing than
 * find the wrong rectangle.
 *
 * The shape of it:
 *
 *   1. Downscale and take a Sobel gradient.
 *   2. Propose a handful of candidate boxes. Two different ways of guessing
 *      "which object are we talking about", because either one alone has a
 *      background that defeats it: connected blobs of edge (inherited from the
 *      old detector) lose a book on a patterned rug, and the edge-mass content
 *      box loses one next to a dark table edge.
 *   3. Snap each candidate's four sides onto the strongest straight line near
 *      them, searching a small range of angles as well as offsets, because a
 *      hand-held book is never quite square to the camera.
 *   4. Score each side by how much it stands out from the lines either side of
 *      it, not by how strong it is outright. A book edge is a spike; a rug's
 *      pattern is a plateau, and a plateau must not read as a book.
 *   5. Take the best candidate, and only if its weakest side is a real spike.
 *
 * Step 5 is the whole safety argument. Steps 1 to 4 will happily produce a
 * rectangle for a photograph of a carpet.
 */

import sharp from 'sharp'

/**
 * Working width for detection. Everything runs on a downscale, both for speed
 * and because a 4K photograph's sensor noise is edge energy we do not want.
 * The rectangle is scaled back to source pixels at the end.
 */
export const DETECT_WIDTH = 480

/**
 * A gradient counts as an edge above this fraction of the frame's strongest
 * gradients. Relative to the strong end rather than a percentile of all
 * pixels: a percentile promotes sensor noise to an edge as soon as the
 * background is plain, which merges the whole frame into one blob.
 */
const EDGE_OF_STRONGEST = 0.28

/** Radius of the morphological closing that joins a cover's outline up. */
const CLOSE_RADIUS = 2

/** Fraction of edge mass trimmed off each side to make the content box. */
const CONTENT_TRIM = 0.02

/** A candidate box must cover at least this fraction of the frame. */
const MIN_AREA_RATIO = 0.04

/**
 * ...and at most this. Larger means the gradient merged the book into the
 * room, or the "book" is the whole photograph and cropping gains nothing.
 */
const MAX_AREA_RATIO = 0.9

/** Width over height. Wide enough for a spine strip and a book laid flat. */
const MIN_ASPECT = 0.08
const MAX_ASPECT = 4.0

/** How far a side may be moved when snapping, as a fraction of the frame. */
const SNAP_RANGE = 0.05

/** Angles searched when snapping a side, in degrees. */
const SNAP_ANGLES = [-8, -6, -4, -2, 0, 2, 4, 6, 8]

/**
 * How far each side must stand above the typical line in its own search band.
 *
 * This is the number that decides whether we crop, and it is deliberately the
 * last thing between a photograph of somebody's floor and a confident crop of
 * it. Measuring against the band rather than the frame is what tells a book's
 * edge (a spike among quiet neighbours) from a floorboard seam or a rug's
 * repeat (one of many equals).
 */
const MIN_PROMINENCE = 2.6

/** ...and it must still be a real edge in absolute terms. */
const MIN_ABSOLUTE = 1.8

/**
 * Grey levels the inside of every side must differ from the outside by.
 *
 * A book is an object lying on something else, so all four of its sides step
 * the same way: the cover is lighter than the floor, or darker than it, on
 * every side at once. A rug's repeat and a floorboard's seam are edges with
 * the same stuff on both sides of them, and they alternate. Insisting on one
 * consistent step is what tells "the edge of a thing" from "an edge".
 */
const MIN_STEP = 9

/** How far either side of a line the inside and outside are sampled. */
const STEP_OFFSET = 5

/** Grow the final rectangle by this fraction of its own size on every side. */
const PAD_FRACTION = 0.015

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export type CropRefusal =
  | 'no-edges'
  | 'no-candidate'
  | 'weak-edges'
  | 'implausible-shape'

export interface EdgeScores {
  left: number
  right: number
  top: number
  bottom: number
}

export interface CropDecision {
  /** The rectangle in source pixels, or null when we declined. */
  rect: Rect | null
  /** 0 to 1. Only meaningful when `rect` is set. */
  confidence: number
  /** Why we declined. Undefined when we did not. */
  refusal?: CropRefusal
  /** How far each side stood above the typical line near it. */
  prominence?: EdgeScores
}

interface Grey {
  data: Uint8Array
  width: number
  height: number
  /** Source pixels per working pixel. */
  scale: number
  sourceWidth: number
  sourceHeight: number
}

interface Gradient {
  gx: Float32Array
  gy: Float32Array
  mag: Float32Array
  mean: number
  width: number
  height: number
}

/**
 * A line across the frame: an offset measured at the frame's own centre, plus
 * a slope. Vertical sides are x = offset + (y - height/2) * slope; horizontal
 * sides are y = offset + (x - width/2) * slope. Always the frame's centre, so
 * that intersecting two lines later uses the same reference the search did.
 */
interface Line {
  offset: number
  slope: number
  /** Mean gradient along the line, relative to the frame's mean gradient. */
  strength: number
  /** Strength over the typical strength in its own search band. */
  prominence: number
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Decode, downscale and flatten a photograph to grey working pixels. */
async function toGrey(input: Buffer): Promise<Grey> {
  const probe = await sharp(input).rotate().metadata()
  const sourceWidth = probe.width ?? 0
  const sourceHeight = probe.height ?? 0
  if (!sourceWidth || !sourceHeight) throw new Error('image has no dimensions')

  const { data, info } = await sharp(input)
    // .rotate() with no argument applies the EXIF orientation. A phone photo
    // that is portrait only by tag would otherwise be detected sideways and
    // the rectangle handed back transposed.
    .rotate()
    .resize({ width: DETECT_WIDTH, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    // Sensor noise is edge energy spread over the whole frame, and it is the
    // thing that makes a quiet background look busy.
    .blur(1.1)
    .raw()
    .toBuffer({ resolveWithObject: true })

  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height,
    scale: sourceWidth / info.width,
    sourceWidth,
    sourceHeight,
  }
}

function sobel(grey: Grey): Gradient {
  const { data, width: w, height: h } = grey
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  const mag = new Float32Array(w * h)
  let total = 0

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const a = data[i - w - 1]!, b = data[i - w]!, c = data[i - w + 1]!
      const d = data[i - 1]!, f = data[i + 1]!
      const g = data[i + w - 1]!, k = data[i + w]!, l = data[i + w + 1]!
      const dx = (c + 2 * f + l) - (a + 2 * d + g)
      const dy = (g + 2 * k + l) - (a + 2 * b + c)
      gx[i] = dx
      gy[i] = dy
      const m = Math.hypot(dx, dy)
      mag[i] = m
      total += m
    }
  }

  return { gx, gy, mag, mean: total / (w * h), width: w, height: h }
}

/** The value below which a gradient is not treated as an edge. */
function edgeThreshold(mag: Float32Array): number {
  const sorted = Float32Array.from(mag).sort()
  // The 99.5th percentile rather than the maximum: one blown highlight should
  // not set the scale for the whole frame.
  const strong = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.995))] ?? 0
  return strong * EDGE_OF_STRONGEST
}

/**
 * Grow then shrink the mask by the same radius. Closing joins a cover's
 * outline back up where it fades into a similar background, which is the usual
 * reason a book's contour breaks into pieces, without the net outward bias
 * that dilating more than eroding would leave in the box.
 */
function close(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return morph(morph(mask, w, h, radius, true), w, h, radius, false)
}

/** One separable pass of a square max (dilate) or min (erode) filter. */
function morph(mask: Uint8Array, w: number, h: number, radius: number, dilate: boolean): Uint8Array {
  const seed = dilate ? 0 : 1
  const horizontal = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = seed
      for (let d = -radius; d <= radius; d++) {
        const sx = x + d
        if (sx < 0 || sx >= w) continue
        const v = mask[y * w + sx]!
        acc = dilate ? (v > acc ? v : acc) : (v < acc ? v : acc)
      }
      horizontal[y * w + x] = acc
    }
  }

  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = seed
      for (let d = -radius; d <= radius; d++) {
        const sy = y + d
        if (sy < 0 || sy >= h) continue
        const v = horizontal[sy * w + x]!
        acc = dilate ? (v > acc ? v : acc) : (v < acc ? v : acc)
      }
      out[y * w + x] = acc
    }
  }
  return out
}

/** Label 8-connected blobs and return each one's bounding box. */
function blobBoxes(mask: Uint8Array, w: number, h: number): Box[] {
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const found: Box[] = []

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue

    let top = stack.length
    stack[--top] = start
    seen[start] = 1
    const sx = start % w
    const sy = (start - sx) / w
    const box: Box = { left: sx, right: sx, top: sy, bottom: sy }

    while (top < stack.length) {
      const i = stack[top++]!
      const x = i % w
      const y = (i - x) / w
      if (x < box.left) box.left = x
      if (x > box.right) box.right = x
      if (y < box.top) box.top = y
      if (y > box.bottom) box.bottom = y

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const j = ny * w + nx
          if (mask[j] && !seen[j]) {
            seen[j] = 1
            stack[--top] = j
          }
        }
      }
    }

    found.push(box)
  }

  return found
}

/**
 * The box holding all but the outermost fraction of the frame's edge mass.
 *
 * A printed cover carries most of the edge in a photograph of one, so trimming
 * the quiet margins lands on the book even where its outline is too faint to
 * survive as a blob. It fails the other way round, on a frame with a busy
 * corner, which is why it is one candidate among several rather than the
 * answer.
 */
function contentBox(mask: Uint8Array, w: number, h: number): Box | null {
  const columns = new Float64Array(w)
  const rows = new Float64Array(h)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      columns[x] = columns[x]! + 1
      rows[y] = rows[y]! + 1
      total++
    }
  }
  if (total <= 0) return null

  const trim = total * CONTENT_TRIM
  const edge = (profile: Float64Array, fromStart: boolean): number => {
    let seen = 0
    if (fromStart) {
      for (let i = 0; i < profile.length; i++) {
        seen += profile[i]!
        if (seen > trim) return i
      }
      return profile.length - 1
    }
    for (let i = profile.length - 1; i >= 0; i--) {
      seen += profile[i]!
      if (seen > trim) return i
    }
    return 0
  }

  return {
    left: edge(columns, true),
    right: edge(columns, false),
    top: edge(rows, true),
    bottom: edge(rows, false),
  }
}

/**
 * Otsu's threshold: the grey level that best splits the frame in two.
 *
 * Gradient alone loses a book on a patterned background, because the pattern
 * has as much edge in it as the cover does. Brightness does not: a cover is
 * one flat tone against another, whatever is printed on the floor. This gives
 * the search a candidate it would not otherwise have.
 */
function otsu(data: Uint8Array): number {
  const histogram = new Int32Array(256)
  for (let i = 0; i < data.length; i++) histogram[data[i]!] = histogram[data[i]!]! + 1

  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * histogram[v]!

  let backgroundWeight = 0
  let backgroundSum = 0
  let best = 0
  let bestVariance = -1

  for (let t = 0; t < 256; t++) {
    backgroundWeight += histogram[t]!
    if (!backgroundWeight) continue
    const foregroundWeight = data.length - backgroundWeight
    if (!foregroundWeight) break
    backgroundSum += t * histogram[t]!
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (sum - backgroundSum) / foregroundWeight
    const between = backgroundWeight * foregroundWeight
      * (backgroundMean - foregroundMean) * (backgroundMean - foregroundMean)
    if (between > bestVariance) {
      bestVariance = between
      best = t
    }
  }

  return best
}

/** Boxes of the largest connected regions on one side of a brightness split. */
function toneBoxes(grey: Grey, threshold: number, lighter: boolean): Box[] {
  const { data, width: w, height: h } = grey
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (lighter ? data[i]! > threshold : data[i]! <= threshold) ? 1 : 0
  }
  // A cover is not one flat tone: closing swallows the title, so the region
  // that comes back is the cover rather than the paper around the letters.
  const filled = close(mask, w, h, 4)
  return blobBoxes(filled, w, h)
    .filter((box) => plausible(box, w, h))
    .sort((a, b) =>
      (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))
    .slice(0, 2)
}

/** Bilinear sample of a float plane, zero outside. */
function sample(plane: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const a = plane[y0 * w + x0]!, b = plane[y0 * w + x1]!
  const c = plane[y1 * w + x0]!, d = plane[y1 * w + x1]!
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * Find the strongest near-straight line whose offset is within `range` of the
 * seed, measured only along the span the book is thought to occupy.
 *
 * `vertical` decides which derivative is measured. Using |gx| for a vertical
 * side rather than the gradient magnitude is what stops a strong horizontal
 * feature crossing the search band, a skirting board or a shelf lip, from
 * standing in for the book's side.
 */
function snap(
  g: Gradient,
  vertical: boolean,
  seed: number,
  range: number,
  from: number,
  to: number,
): Line {
  const plane = vertical ? g.gx : g.gy
  const limit = vertical ? g.width : g.height
  const acrossLimit = vertical ? g.height : g.width
  const centre = (vertical ? g.height : g.width) / 2

  const start = Math.max(1, Math.ceil(Math.min(from, to)))
  const end = Math.min(acrossLimit - 2, Math.floor(Math.max(from, to)))
  if (end <= start) return { offset: seed, slope: 0, strength: 0, prominence: 0 }

  let best: Line = { offset: seed, slope: 0, strength: 0, prominence: 0 }
  const everything: number[] = []

  for (const degrees of SNAP_ANGLES) {
    const slope = Math.tan((degrees * Math.PI) / 180)
    for (let offset = seed - range; offset <= seed + range; offset += 0.5) {
      if (offset < 0 || offset > limit - 1) continue
      let total = 0
      let count = 0
      for (let along = start; along <= end; along++) {
        const across = offset + (along - centre) * slope
        const value = vertical
          ? sample(plane, g.width, g.height, across, along)
          : sample(plane, g.width, g.height, along, across)
        total += Math.abs(value)
        count++
      }
      if (!count) continue
      const strength = total / count
      everything.push(strength)
      if (strength > best.strength) best = { offset, slope, strength, prominence: 0 }
    }
  }

  const typical = median(everything)
  best.prominence = typical > 1e-6 ? best.strength / typical : 0
  best.strength = g.mean > 1e-6 ? best.strength / g.mean : 0
  return best
}

/**
 * The axis-aligned box around the quadrilateral described by two vertical and
 * two horizontal lines. Taking the outer extent of the corners rather than the
 * lines' own offsets is what keeps a tilted book's corners inside the crop.
 */
function boxOf(g: Gradient, left: Line, right: Line, top: Line, bottom: Line): Box {
  const centreY = g.height / 2
  const centreX = g.width / 2
  const xs: number[] = []
  const ys: number[] = []

  for (const horizontal of [top, bottom]) {
    for (const vertical of [left, right]) {
      // x = vertical.offset + (y - centreY) * vertical.slope
      // y = horizontal.offset + (x - centreX) * horizontal.slope
      const denominator = 1 - vertical.slope * horizontal.slope
      if (Math.abs(denominator) < 1e-6) continue
      const x = (vertical.offset - vertical.slope * centreY
        + vertical.slope * (horizontal.offset - horizontal.slope * centreX)) / denominator
      const y = horizontal.offset + (x - centreX) * horizontal.slope
      xs.push(x)
      ys.push(y)
    }
  }

  if (!xs.length) {
    return { left: left.offset, right: right.offset, top: top.offset, bottom: bottom.offset }
  }

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

function plausible(box: Box, w: number, h: number): boolean {
  const width = box.right - box.left
  const height = box.bottom - box.top
  if (width < 8 || height < 8) return false
  const aspect = width / height
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return false
  const area = (width * height) / (w * h)
  return area >= MIN_AREA_RATIO && area <= MAX_AREA_RATIO
}

/**
 * Mean brightness in a band just inside a side, minus just outside it.
 *
 * Positive when the book is lighter than what it is lying on. The sign is the
 * useful part: see MIN_STEP.
 */
function brightnessStep(
  grey: Grey,
  vertical: boolean,
  line: Line,
  from: number,
  to: number,
  inwards: number,
): number {
  const { data, width: w, height: h } = grey
  const centre = (vertical ? h : w) / 2
  const start = Math.max(0, Math.ceil(Math.min(from, to)))
  const end = Math.min((vertical ? h : w) - 1, Math.floor(Math.max(from, to)))
  if (end <= start) return 0

  let inside = 0
  let outside = 0
  let count = 0
  for (let along = start; along <= end; along++) {
    const across = line.offset + (along - centre) * line.slope
    const at = (offset: number): number => {
      const x = Math.round(vertical ? across + offset : along)
      const y = Math.round(vertical ? along : across + offset)
      if (x < 0 || y < 0 || x >= w || y >= h) return Number.NaN
      return data[y * w + x]!
    }
    const near = at(inwards * STEP_OFFSET)
    const far = at(-inwards * STEP_OFFSET)
    if (Number.isNaN(near) || Number.isNaN(far)) continue
    inside += near
    outside += far
    count++
  }

  return count ? (inside - outside) / count : 0
}

interface Candidate {
  box: Box
  prominence: EdgeScores
  strength: EdgeScores
  /** The weakest side's prominence. What the whole decision turns on. */
  worst: number
  /** Smallest brightness step across the four sides, signed consistently. */
  step: number
}

/** Snap a seed box's four sides and score them. */
function refine(g: Gradient, grey: Grey, seed: Box): Candidate | null {
  const range = Math.max(5, SNAP_RANGE * g.width)

  let left: Line = { offset: seed.left, slope: 0, strength: 0, prominence: 0 }
  let right: Line = { offset: seed.right, slope: 0, strength: 0, prominence: 0 }
  let top: Line = { offset: seed.top, slope: 0, strength: 0, prominence: 0 }
  let bottom: Line = { offset: seed.bottom, slope: 0, strength: 0, prominence: 0 }

  // Three passes. The first snaps against the seed's own span; later ones
  // re-measure each side along the span the previous pass established, which
  // matters when the seed was noticeably short on one side.
  for (let pass = 0; pass < 3; pass++) {
    top = snap(g, false, top.offset, range, left.offset, right.offset)
    bottom = snap(g, false, bottom.offset, range, left.offset, right.offset)
    left = snap(g, true, left.offset, range, top.offset, bottom.offset)
    right = snap(g, true, right.offset, range, top.offset, bottom.offset)
  }

  const box = boxOf(g, left, right, top, bottom)
  if (!plausible(box, g.width, g.height)) return null

  const prominence = {
    left: left.prominence, right: right.prominence,
    top: top.prominence, bottom: bottom.prominence,
  }
  const strength = {
    left: left.strength, right: right.strength,
    top: top.strength, bottom: bottom.strength,
  }

  // A side whose absolute gradient is negligible is not an edge however much
  // it stands out from an even quieter band.
  const worst = Math.min(
    ...(['left', 'right', 'top', 'bottom'] as const).map((side) =>
      strength[side] < MIN_ABSOLUTE ? 0 : prominence[side]),
  )

  const steps = [
    brightnessStep(grey, true, left, top.offset, bottom.offset, 1),
    brightnessStep(grey, true, right, top.offset, bottom.offset, -1),
    brightnessStep(grey, false, top, left.offset, right.offset, 1),
    brightnessStep(grey, false, bottom, left.offset, right.offset, -1),
  ]
  // All four the same way round, or this is not the outline of one thing.
  const lightest = Math.min(...steps)
  const darkest = Math.max(...steps)
  const step = lightest > 0 ? lightest : darkest < 0 ? -darkest : 0

  return { box, prominence, strength, worst, step }
}

/**
 * Decide where the book is in a photograph.
 *
 * Returns a rectangle in the coordinates of the EXIF-rotated source image, or
 * a refusal. Never throws for an undetectable book, only for an unreadable
 * file.
 */
export async function detectBook(input: Buffer): Promise<CropDecision> {
  const grey = await toGrey(input)
  const g = sobel(grey)
  const { width: w, height: h } = grey

  if (!(g.mean > 0)) return { rect: null, confidence: 0, refusal: 'no-edges' }

  const threshold = edgeThreshold(g.mag)
  if (!(threshold > 0)) return { rect: null, confidence: 0, refusal: 'no-edges' }

  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) mask[i] = g.mag[i]! >= threshold ? 1 : 0

  const seeds: Box[] = []

  const content = contentBox(mask, w, h)
  if (content && plausible(content, w, h)) seeds.push(content)

  const closed = close(mask, w, h, CLOSE_RADIUS)
  const boxes = blobBoxes(closed, w, h)
    .filter((box) => plausible(box, w, h))
    .sort((a, b) =>
      (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))
  seeds.push(...boxes.slice(0, 3))

  const split = otsu(grey.data)
  seeds.push(...toneBoxes(grey, split, true), ...toneBoxes(grey, split, false))

  if (!seeds.length) return { rect: null, confidence: 0, refusal: 'no-candidate' }

  let best: Candidate | null = null
  let bestRejected: Candidate | null = null
  for (const seed of seeds) {
    const candidate = refine(g, grey, seed)
    if (!candidate) continue
    if (!bestRejected || candidate.worst > bestRejected.worst) bestRejected = candidate
    // The step gate is a filter, not a tie break. A candidate that fails it is
    // not the outline of an object and must not win on a strong edge alone.
    if (candidate.step < MIN_STEP) continue
    if (!best || candidate.worst > best.worst) best = candidate
  }

  if (!best) {
    if (!bestRejected) return { rect: null, confidence: 0, refusal: 'implausible-shape' }
    return { rect: null, confidence: 0, refusal: 'weak-edges', prominence: bestRejected.prominence }
  }

  if (best.worst < MIN_PROMINENCE) {
    return { rect: null, confidence: 0, refusal: 'weak-edges', prominence: best.prominence }
  }

  const boxWidth = best.box.right - best.box.left
  const boxHeight = best.box.bottom - best.box.top
  const padX = boxWidth * PAD_FRACTION
  const padY = boxHeight * PAD_FRACTION
  const scale = grey.scale
  const rect = clamp({
    left: Math.round((best.box.left - padX) * scale),
    top: Math.round((best.box.top - padY) * scale),
    width: Math.round((boxWidth + padX * 2) * scale),
    height: Math.round((boxHeight + padY * 2) * scale),
  }, grey.sourceWidth, grey.sourceHeight)

  if (rect.width < 16 || rect.height < 16) {
    return { rect: null, confidence: 0, refusal: 'implausible-shape', prominence: best.prominence }
  }

  return {
    rect,
    confidence: Math.min(1, 0.5 + (best.worst - MIN_PROMINENCE) / 12),
    prominence: best.prominence,
  }
}

function clamp(rect: Rect, w: number, h: number): Rect {
  const left = Math.max(0, Math.min(rect.left, w - 1))
  const top = Math.max(0, Math.min(rect.top, h - 1))
  return {
    left,
    top,
    width: Math.max(1, Math.min(rect.width, w - left)),
    height: Math.max(1, Math.min(rect.height, h - top)),
  }
}

export interface CropResult extends CropDecision {
  /** The cropped image, when one was made. Null when we declined. */
  image: Buffer | null
}

/**
 * Detect and, if a book was found, produce the cropped image.
 *
 * The caller writes it. Nothing here touches the original: a buffer is read
 * and a new buffer comes back, so there is no path by which a photograph of a
 * real book is overwritten by a bad crop.
 */
export async function cropBook(input: Buffer): Promise<CropResult> {
  const decision = await detectBook(input)
  if (!decision.rect) return { ...decision, image: null }

  const image = await sharp(input)
    .rotate()
    .extract({
      left: decision.rect.left,
      top: decision.rect.top,
      width: decision.rect.width,
      height: decision.rect.height,
    })
    .jpeg({ quality: 90 })
    .toBuffer()

  return { ...decision, image }
}
