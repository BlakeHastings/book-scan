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
 *      them, not by how strong it is outright. A book edge is a spike; a rug's
 *      pattern is a plateau, and a plateau must not read as a book.
 *   5. Check in CIE Lab that all four sides step the same way, near the line
 *      and again further out, because a book differs from what it is lying on
 *      and keeps differing as you walk away from its edge.
 *   6. Take the best candidate, and only if its weakest side is a real spike.
 *
 * Steps 5 and 6 are the whole safety argument. Steps 1 to 4 will happily
 * produce a rectangle for a photograph of a carpet, or for the title bar
 * printed across the front of a book.
 *
 * Measured against 48 of the owner's own photographs, 36 of them ones this
 * declined and 12 it already handled: 4 of the 36 recovered, all 12 kept, and
 * no crop that cut a cover. Three further ideas were built and measured and
 * thrown away, and what they cost is written down where each one was tried,
 * because every one of them found more books by finding the picture printed on
 * the book.
 */

import sharp from 'sharp'

/**
 * Working width for detection. Everything runs on a downscale, both for speed
 * and because a 4K photograph's sensor noise is edge energy we do not want.
 * The rectangle is scaled back to source pixels at the end.
 */
export const DETECT_WIDTH = 480

/**
 * ...and a ceiling on the working height, which only the spine strips reach.
 *
 * The edge slot arrives already cut to `SPINE_CROP`, 511 by 3072 pixels on this
 * phone. Scaling that to 480 wide leaves a 480 by 2885 working frame, and a
 * frame far taller than it is wide breaks the snapping search two ways at once.
 * A side's line is swept in angles, and at eight degrees over 2885 rows the
 * ends move 405 pixels sideways in a frame only 480 wide, so most of the angles
 * on offer describe lines that leave the picture. The angles that remain are
 * spaced two degrees apart, which is a hundred pixels of lateral movement per
 * step, so a spine tilted by one degree in the owner's hand lands between two
 * candidates and is measured smeared across sixty pixels either way. That is
 * why the real spines score around two on a bar of 2.6.
 *
 * Capping the height fixes both: fewer rows means a shorter lever arm for the
 * same angle, and a quarter of the pixels pays for the finer angular sampling
 * the tall shape needed in the first place.
 */
const MAX_DETECT_HEIGHT = DETECT_WIDTH * 3

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

/**
 * Width over height. Wide enough for a spine strip and a book laid flat.
 *
 * Widening the lower bound to 0.03 was tried, on the theory that a paperback
 * spine in a strip 3072 tall is too narrow a shape to be allowed. It is not:
 * the spines that do get found sit at 0.12 to 0.21, comfortably inside this,
 * and loosening it recovered nothing while adding forty per cent to the time by
 * putting more slivers through the snapping search. Left where it is.
 */
const MIN_ASPECT = 0.08
const MAX_ASPECT = 4.0

/** How far a side may be moved when snapping, as a fraction of the frame. */
const SNAP_RANGE = 0.05

/** The widest tilt a side is searched at, in degrees. */
const SNAP_MAX_ANGLE = 8

/**
 * How far apart two neighbouring tilts may land, measured in pixels at the ends
 * of the span rather than in degrees.
 *
 * Degrees were the wrong unit. Two degrees is a fifth of a pixel across a
 * thumbnail and a hundred pixels down a spine strip, so a fixed list of degrees
 * samples finely where nothing needed it and misses the answer entirely where
 * it mattered. Fixing the spacing in pixels asks the question the search is
 * really asking: how far can this line be wrong at its ends before the edge it
 * is meant to lie on smears into the average.
 */
const SNAP_SWEEP_STEP = 4

/** ...and a ceiling on how many tilts that spacing may ask for, per side. */
const SNAP_MAX_STEPS = 12

/** Offsets are tried this far apart, in working pixels. */
const SNAP_OFFSET_STEP = 1

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
 * How far, in CIE Lab, the inside of every side must differ from the outside.
 *
 * A book is an object lying on something else, so all four of its sides step
 * the same way: the cover differs from the floor in the same direction on every
 * side at once. A rug's repeat and a floorboard's seam are edges with the same
 * stuff on both sides of them, and they alternate. Insisting on one consistent
 * step is what tells "the edge of a thing" from "an edge".
 *
 * This used to be nine grey levels, and grey was the wrong place to measure it.
 * Measured on the owner's photographs, the covers that worked were pale and the
 * covers that failed were dark, in the same room on the same table: it was a
 * luminance-step detector wearing an object detector's clothes. A salmon spine
 * on dark wood, or an orange one, is a large step that greyscale throws away
 * because both collapse to about the same tone. Lab keeps the difference,
 * which is why the gate now lives here.
 *
 * The number is in Lab units, where L runs 0 to 100. Nine grey levels near
 * mid-tone is about 3.4 of them, so four is slightly stricter than the gate it
 * replaces, and every photograph this recovers is recovered by the colour axes
 * rather than by a looser bar.
 *
 * Four is where it sits because of where the two populations fall. Across the
 * owner's photographs the weakest correct crop scores 4.4 and the one rectangle
 * that cut a cover in half scores 3.3, so the gap between them is the only
 * honest place to put it.
 */
const MIN_STEP = 4

/**
 * How much the colour axes count relative to lightness.
 *
 * One is the honest CIE 1976 answer and is what this uses. It is named rather
 * than inlined because it is the single knob that trades recall against wrong
 * crops here, and a future reader should be able to find it.
 */
const CHROMA_WEIGHT = 1

/** How far either side of a line the inside and outside are sampled. */
const STEP_OFFSET = 5

/**
 * ...and how far out the same difference is checked again.
 *
 * What tells the edge of a book from a band printed across the front of one is
 * not how big the difference is, it is whether the difference keeps. Move away
 * from a book's edge and the table is still there. Move away from the join
 * between a red title panel and the artwork below it and you are still on the
 * cover. Measured on the owner's photographs this was the whole of the
 * difference between a tight crop and a cover cut in half: every wrong crop had
 * a side that stepped convincingly at five pixels and said nothing at sixteen.
 */
const FAR_OFFSET = 16

/** Grow the final rectangle by this fraction of its own size on every side. */
const PAD_FRACTION = 0.015

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Why no rectangle came back.
 *
 * `weak-edges` and `low-contrast` used to be one value, and conflating them hid
 * the most useful thing a refusal can say. They are different failures with
 * different fixes: `weak-edges` means no rectangle in the frame looked like the
 * outline of anything, and `low-contrast` means one did, convincingly, and was
 * then discarded because the cover and the surface underneath it were too close
 * in tone for the step gate. The second is a book the detector had already
 * found, so counting them apart is what tells "look harder" from "measure the
 * difference in a better colour space".
 */
export type CropRefusal =
  | 'no-edges'
  | 'no-candidate'
  | 'weak-edges'
  | 'low-contrast'
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
  /** The consistent step across the four sides the decision was judged on. */
  step?: number
}

interface Grey {
  data: Uint8Array
  /**
   * The same pixels in CIE Lab, three floats each, L then a then b.
   *
   * Float rather than sharp's 8-bit Lab on purpose: the 8-bit form stores a*
   * and b* unsigned and clips everything negative to zero, so a navy cover
   * (b* about -10) and a neutral grey one come back identical. That clipping
   * silently deletes exactly the blues and greens this is here to measure.
   */
  lab: Float32Array
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

  // One decode, two views of the same working pixels. Both go through the same
  // rotate, resize and blur, so a pixel index means the same place in each.
  const prepared = sharp(input)
    // .rotate() with no argument applies the EXIF orientation. A phone photo
    // that is portrait only by tag would otherwise be detected sideways and
    // the rectangle handed back transposed.
    .rotate()
    .resize({
      width: DETECT_WIDTH,
      height: MAX_DETECT_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // Sensor noise is edge energy spread over the whole frame, and it is the
    // thing that makes a quiet background look busy.
    .blur(1.1)

  const [grey, lab] = await Promise.all([
    prepared.clone().greyscale().raw().toBuffer({ resolveWithObject: true }),
    prepared.clone().toColourspace('lab').raw({ depth: 'float' }).toBuffer({ resolveWithObject: true }),
  ])

  const { data, info } = grey

  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.length),
    lab: new Float32Array(lab.data.buffer, lab.data.byteOffset, lab.data.length / 4),
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

/**
 * Boxes of the largest connected regions on one side of a brightness split.
 *
 * Two colour-aware ways of proposing regions were tried here and both were
 * removed, for the same reason. Splitting the frame by colourfulness, and
 * splitting it by distance from the colour of the border, each found more books
 * than brightness does: ten of the owner's thirty-six failures rather than
 * four. Six of those ten were right and four cut a cover in half, and looking
 * at the four says exactly what happened. A cover is not one region of colour.
 * "Mary Barton" is a bordered photograph of a sewing machine, "Beasts" is a
 * painting under a title bar, "Sunrise on the Reaping" is an emblem on a plain
 * ground, and every one of those crops came back as the artwork with the title
 * cut off. Anything that proposes regions by colour proposes the picture on the
 * book rather than the book, and the gates cannot tell the two apart because a
 * printed panel genuinely does have four consistent sides.
 */
function toneBoxes(grey: Grey, plane: Uint8Array, threshold: number, lighter: boolean): Box[] {
  const { width: w, height: h } = grey
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (lighter ? plane[i]! > threshold : plane[i]! <= threshold) ? 1 : 0
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

  // Tilts spaced by a fixed lateral distance at the ends of the span actually
  // measured, so a long span is sampled finely enough to land on its edge and a
  // short one does not pay for tilts it cannot tell apart.
  const widest = Math.tan((SNAP_MAX_ANGLE * Math.PI) / 180)
  const steps = Math.max(2, Math.min(
    SNAP_MAX_STEPS,
    Math.round(((end - start) * widest) / SNAP_SWEEP_STEP),
  ))

  for (let step = -steps; step <= steps; step++) {
    const slope = (widest * step) / steps
    for (let offset = seed - range; offset <= seed + range; offset += SNAP_OFFSET_STEP) {
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

/** A colour difference across one side: inside minus outside, in Lab. */
interface LabStep {
  dL: number
  da: number
  db: number
}

/**
 * Mean Lab colour in a band just inside a side, minus just outside it.
 *
 * The direction of the vector is the useful part, not just its length: see
 * MIN_STEP. A cover that is lighter than the table gives every side a positive
 * dL, and a salmon cover on dark wood gives every side the same push along a*
 * even where dL is nearly nothing.
 */
function labStep(
  grey: Grey,
  vertical: boolean,
  line: Line,
  from: number,
  to: number,
  inwards: number,
  outward: number,
): LabStep | null {
  const { lab, width: w, height: h } = grey
  const centre = (vertical ? h : w) / 2
  const start = Math.max(0, Math.ceil(Math.min(from, to)))
  const end = Math.min((vertical ? h : w) - 1, Math.floor(Math.max(from, to)))
  if (end <= start) return null

  let dL = 0
  let da = 0
  let db = 0
  let count = 0
  for (let along = start; along <= end; along++) {
    const across = line.offset + (along - centre) * line.slope
    const at = (offset: number): number => {
      const x = Math.round(vertical ? across + offset : along)
      const y = Math.round(vertical ? along : across + offset)
      if (x < 0 || y < 0 || x >= w || y >= h) return -1
      return (y * w + x) * 3
    }
    const inside = at(inwards * STEP_OFFSET)
    const outside = at(-inwards * outward)
    if (inside < 0 || outside < 0) continue
    dL += lab[inside]! - lab[outside]!
    da += lab[inside + 1]! - lab[outside + 1]!
    db += lab[inside + 2]! - lab[outside + 2]!
    count++
  }

  // Null rather than zero when there was nothing to look at. A side whose
  // outer band falls off the picture has not been measured, and scoring that
  // as "no difference" would reject every book photographed near the frame's
  // edge for the wrong reason.
  if (count < (end - start) / 2) return null
  return { dL: dL / count, da: da / count, db: db / count }
}

/** Both readings of one side: at the near band, and again further out. */
function sideSteps(
  grey: Grey,
  vertical: boolean,
  line: Line,
  from: number,
  to: number,
  inwards: number,
): LabStep[] {
  const near = labStep(grey, vertical, line, from, to, inwards, STEP_OFFSET)
  if (!near) return []
  const far = labStep(grey, vertical, line, from, to, inwards, FAR_OFFSET)
  return far ? [near, far] : [near]
}

/**
 * How far the four sides step, given that they must all step the same way.
 *
 * "The same way" used to mean the same sign of one number. In Lab it means one
 * direction in three dimensions, and the honest question is: is there any
 * direction along which all four sides move forward, and how far does the
 * laggard get? That is the largest value of the smallest projection, over every
 * unit direction, and it is zero exactly when no such direction exists.
 *
 * Searching every direction is not worth it for four vectors. The maximum sits
 * either where one side is the binding constraint or where several are, so the
 * candidates tried are the lightness axis (which reproduces the old greyscale
 * rule, in both signs), each side's own direction, and their sum. Taking the
 * best of those is never worse than the rule this replaced, which is what keeps
 * a pale cover on a dark floor behaving exactly as it did.
 */
function agreedStep(steps: LabStep[]): number {
  const weight = CHROMA_WEIGHT
  // Weighting is folded in once here so a projection is a plain dot product.
  const v = steps.map((s) => [s.dL, s.da * weight, s.db * weight] as const)

  const sum = v.reduce(
    (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as const,
    [0, 0, 0] as const,
  )
  const directions = [[1, 0, 0] as const, [-1, 0, 0] as const, sum, ...v]

  let best = 0
  for (const d of directions) {
    const length = Math.hypot(d[0], d[1], d[2])
    if (!(length > 1e-6)) continue
    // All four, with no allowance for a quiet one.
    //
    // Letting a single side abstain was tried, on the reasoning that a hand
    // across the bottom edge or a book lying in its own shadow leaves one side
    // saying nothing while the other three are certain. It recovered five more
    // of the owner's photographs and sliced two covers doing it, and looking at
    // them explains why: a rectangle whose bottom edge runs through the middle
    // of a cover has exactly the shape the allowance was written to forgive. Of
    // the five it gained, the two it got wrong were the only ones it gained
    // that the strict rule had not already found, so it bought nothing except
    // its own failures. A sliced cover is worse than a whole one, so the rule
    // stays strict and the quiet-side cases stay declined.
    let worst = Infinity
    for (const s of v) {
      const projected = (s[0] * d[0] + s[1] * d[1] + s[2] * d[2]) / length
      if (projected < worst) worst = projected
    }
    if (worst > best) best = worst
  }
  return best
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

  // All four the same way round, near the line and again further out.
  const step = agreedStep([
    ...sideSteps(grey, true, left, top.offset, bottom.offset, 1),
    ...sideSteps(grey, true, right, top.offset, bottom.offset, -1),
    ...sideSteps(grey, false, top, left.offset, right.offset, 1),
    ...sideSteps(grey, false, bottom, left.offset, right.offset, -1),
  ])

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
  seeds.push(
    ...toneBoxes(grey, grey.data, split, true),
    ...toneBoxes(grey, grey.data, split, false),
  )

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
    // Geometry that would have been accepted, thrown away at the step gate: the
    // book was located and then discarded for being too close in tone to what
    // it was lying on. Said apart from "no rectangle looked like anything".
    return {
      rect: null,
      confidence: 0,
      refusal: bestRejected.worst >= MIN_PROMINENCE ? 'low-contrast' : 'weak-edges',
      prominence: bestRejected.prominence,
      step: bestRejected.step,
    }
  }

  if (best.worst < MIN_PROMINENCE) {
    return {
      rect: null, confidence: 0, refusal: 'weak-edges',
      prominence: best.prominence, step: best.step,
    }
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
    step: best.step,
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
