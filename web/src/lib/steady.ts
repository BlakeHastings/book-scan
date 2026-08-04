/**
 * Keeping the sharpest frame of a short burst, so a shaky hand still lands a
 * readable photo.
 *
 * The camera cannot be made to hold still, and on iOS none of the levers that
 * would help are exposed: WebKit's capture source implements exactly width,
 * height, aspectRatio, frameRate, facingMode, deviceId, groupId, focusDistance,
 * whiteBalanceMode, zoom and torch. There is no exposure control and no
 * stabilisation call anywhere in it. So the one thing genuinely under our
 * control is *which* frame we keep.
 *
 * Hand tremor is periodic, roughly 4 to 12 times a second, which means it has
 * turning points: moments where the hand is changing direction and is briefly
 * almost still. A burst spanning a couple of tremor cycles will contain one of
 * those, and it is measurably sharper than its neighbours. Taking the best of
 * seven frames costs about a fifth of a second and no extra tap, which is the
 * whole reason this is preferred to asking the person to hold steadier.
 *
 * Why not gate the shutter on steadiness instead: a shutter that refuses to
 * fire until the phone is still is a shutter that never fires for exactly the
 * person this is for. Picking the best of what arrived cannot fail that way.
 *
 * This deliberately avoids DeviceMotion. iOS requires an explicit permission
 * prompt for it, granted from a user gesture, which is one more prompt and one
 * more tap; the frames we are already drawing carry the same information.
 */

import { cropToSource, type CaptureOptions } from './scanner'

/**
 * How many frames a burst examines.
 *
 * Set from measurement, not from taste. A burst of five costs a measured 200ms
 * on top of a single capture, and almost all of that is waiting for the camera
 * rather than working: at 2160x3840 the same burst adds the same 200ms whether
 * it is cropping a spine or keeping the whole frame, because the per-frame
 * drawing is a rounding error beside the 1/30s between frames. Seven frames
 * measured 280ms for the same reason, and that is a third of a second the
 * person taking the fortieth photograph of the afternoon pays again.
 *
 * Five is enough because of what the burst has to contain. Hand tremor runs
 * from about 4Hz upward, and displacement reverses twice a cycle, so a window
 * of half the slowest period, 125ms, is guaranteed to hold a moment where the
 * hand is turning round and briefly barely moving. Five frames at 30fps spans
 * about 165ms, which clears that with a little to spare. Going wider buys
 * repeats of a turning point already sampled.
 */
export const BURST_FRAMES = 5

/**
 * The safety net, not the usual control.
 *
 * On a camera running at 30fps the frame count above ends the burst first and
 * this never bites. It is here for the camera that is delivering at fifteen,
 * or the phone that is busy elsewhere: whatever has arrived by now is what
 * gets picked from, rather than the shutter turning into a wait.
 *
 * It stops the burst asking for another frame; it cannot cut short a wait
 * already begun, so a burst can overrun it by one frame interval.
 */
export const BURST_BUDGET_MS = 250

/**
 * Width the sharpness score is measured at.
 *
 * Scoring at full resolution would cost more than the burst saves, and it is
 * not more accurate: blur is a low-frequency property of the whole frame and
 * survives downscaling, while sensor noise, which a Laplacian happily reads as
 * detail, does not. So the small copy is both cheaper and a slightly better
 * discriminator than the original.
 */
export const SCORE_WIDTH = 240

/**
 * Rec. 601 luma, which is what the retired Python did before this was a web
 * app, so scores stay comparable with anything recorded back then.
 */
export function toGrayscale(rgba: ArrayLike<number>, out?: Uint8ClampedArray): Uint8ClampedArray {
  const pixels = Math.floor(rgba.length / 4)
  const gray = out && out.length >= pixels ? out : new Uint8ClampedArray(pixels)
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4
    gray[i] = 0.299 * rgba[at]! + 0.587 * rgba[at + 1]! + 0.114 * rgba[at + 2]!
  }
  return gray
}

/**
 * Variance of the Laplacian. Higher is crisper.
 *
 * The same measure the Python implementation used (`sharpness` in
 * `bookscan/recognize.py`, retired in 6f1ff08), which was
 * `cv2.Laplacian(gray, CV_64F).var()`. A blurred image has had its high
 * frequencies removed, so the second derivative is small everywhere and its
 * variance collapses; a sharp one has strong edges and a wide spread.
 *
 * Only interior pixels are summed. The border has no full neighbourhood, and
 * OpenCV would extrapolate it, which invents edges at the frame edge that no
 * two frames of a burst would agree on.
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0

  let sum = 0
  let sumSquares = 0
  let count = 0

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x
      const value = 4 * gray[at]!
        - gray[at - 1]! - gray[at + 1]! - gray[at - width]! - gray[at + width]!
      sum += value
      sumSquares += value * value
      count += 1
    }
  }

  if (!count) return 0
  const mean = sum / count
  return sumSquares / count - mean * mean
}

/**
 * Which frame of a burst to keep. Highest score wins.
 *
 * Ties go to the earliest, so a run of identical scores (a perfectly still
 * phone, or a stalled camera handing back the same frame) settles on the first
 * rather than drifting to the last for no reason.
 */
export function sharpestIndex(scores: readonly number[]): number {
  let chosen = -1
  let best = -Infinity
  scores.forEach((score, index) => {
    if (score > best) {
      best = score
      chosen = index
    }
  })
  return chosen
}

export interface BurstResult {
  /** Sharpness of every frame examined, in the order they arrived. */
  scores: number[]
  /** Index into `scores` of the one kept, or -1 if no frame arrived. */
  chosen: number
  /** What the burst actually cost, so it can be measured rather than guessed. */
  elapsedMs: number
}

export interface BurstDeps {
  frames: number
  budgetMs: number
  now: () => number
  /** Resolve once the camera has a frame we have not already looked at. */
  wait: () => Promise<void>
  /** Score the frame on screen now, or null if there is not one yet. */
  grab: () => number | null
  /** Hold on to the frame `grab` just scored: it is the best so far. */
  keep: () => void
}

/**
 * Run the burst and keep the sharpest frame.
 *
 * The frame handling is injected rather than reached for, so the choice can be
 * tested without a camera, a canvas or a clock. That matters more than it
 * looks: everything else here is arithmetic that either works or obviously
 * does not, while "keep the best one" is the part that can silently degrade
 * into "keep the last one" and still appear to work.
 *
 * `keep` is called as the burst runs rather than once at the end, because
 * there is no way to go back for an earlier frame: a video element only ever
 * offers the frame it is showing now.
 */
export async function runBurst(deps: BurstDeps): Promise<BurstResult> {
  const { frames, budgetMs, now, wait, grab, keep } = deps

  const started = now()
  const scores: number[] = []
  let chosen = -1
  let best = -Infinity

  for (let index = 0; index < frames; index += 1) {
    const score = grab()
    if (score !== null) {
      scores.push(score)
      if (score > best) {
        best = score
        chosen = scores.length - 1
        keep()
      }
    }

    // Never wait after the last frame: the burst is over and the wait would be
    // delay nobody gets anything for. Stop early if the budget has gone.
    if (index === frames - 1 || now() - started >= budgetMs) break
    await wait()
  }

  return { scores, chosen, elapsedMs: now() - started }
}

/**
 * What the last burst did, in words somebody can read off a phone and repeat
 * back down a telephone.
 *
 * This is the only way to answer, without owning the phone, whether a burst is
 * worth its fifth of a second: if a real shaky-handed shot shows the frames
 * barely differing, the burst is buying nothing and should be shortened. The
 * spread is the number that settles it, so it is the number that is shown.
 */
export function describeBurst(scores: readonly number[], chosen: number, elapsedMs: number): string {
  if (!scores.length || chosen < 0) return ''

  const best = scores[chosen]!
  const worst = Math.min(...scores)
  const frames = `${scores.length} frame${scores.length === 1 ? '' : 's'}`
  const took = `${Math.round(elapsedMs)}ms`

  if (scores.length === 1) return `Best of ${frames} in ${took}.`

  // Against the worst rather than the average: it is the frame that would have
  // been kept on an unlucky tap, so it is what the burst actually saved us
  // from.
  const gain = worst > 0 ? Math.round(((best - worst) / worst) * 100) : 0
  return `Best of ${frames} in ${took}, kept number ${chosen + 1}, ${gain}% sharper than the worst.`
}

export interface SteadyCapture extends BurstResult {
  /** JPEG data URL of the frame kept, or '' if the camera gave us nothing. */
  image: string
}

export interface SteadyOptions extends CaptureOptions {
  frames?: number
  budgetMs?: number
  now?: () => number
  wait?: () => Promise<void>
}

/**
 * Wait for a frame the camera has not shown yet.
 *
 * `requestVideoFrameCallback` fires per decoded video frame, so each burst
 * iteration is guaranteed a new one. Without it a burst would happily score
 * the same frame several times over and pick between identical copies, which
 * costs the wait and buys nothing. Safari has had it since 15.4;
 * requestAnimationFrame is the fallback and is only display-paced, so it can
 * repeat a frame.
 */
export function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  const request = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number
  }).requestVideoFrameCallback

  if (typeof request === 'function') {
    return new Promise((resolve) => { request.call(video, () => resolve()) })
  }
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => { requestAnimationFrame(() => resolve()) })
  }
  return new Promise((resolve) => { setTimeout(resolve, 33) })
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return context ? { canvas, context } : null
}

/**
 * Take a short burst and return the sharpest frame as a JPEG data URL.
 *
 * A drop-in replacement for `captureStill`, same crop and same encoding, so
 * nothing downstream can tell the difference except that the picture is less
 * likely to be blurred. Resolution and JPEG quality are untouched on purpose:
 * the spine crop is already down to a few hundred source pixels across, and
 * trading any of them for steadiness would cost the ISBN.
 *
 * Two full-size buffers are allocated and then swapped by reference rather
 * than copied, so a burst of any length still only ever holds two frames, and
 * only the winner is ever JPEG encoded. The expensive parts of a capture, the
 * full-resolution draw and the encode, therefore happen once each per burst
 * plus one cheap extra draw per frame examined.
 */
export async function captureSteadiest(
  video: HTMLVideoElement,
  options: SteadyOptions = {},
): Promise<SteadyCapture> {
  const {
    maxWidth = 2400,
    crop,
    frames = BURST_FRAMES,
    budgetMs = BURST_BUDGET_MS,
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    wait = () => nextVideoFrame(video),
  } = options

  const nothing: SteadyCapture = { image: '', scores: [], chosen: -1, elapsedMs: 0 }
  if (!video.videoWidth || !video.videoHeight) return nothing

  // Measured once and reused for every frame of the burst. The layout cannot
  // move mid-burst, and holding it fixed is also what makes the scores
  // comparable: a crop that shifted between frames would be scoring different
  // pictures against each other.
  const { sx, sy, sw, sh } = crop
    ? cropToSource(video, crop)
    : { sx: 0, sy: 0, sw: video.videoWidth, sh: video.videoHeight }

  const scale = Math.min(1, maxWidth / sw)
  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))

  const scoreWidth = Math.max(1, Math.min(SCORE_WIDTH, width))
  const scoreHeight = Math.max(1, Math.round((height * scoreWidth) / width))

  let candidate = canvasOf(width, height)
  let winner = canvasOf(width, height)
  const scorer = canvasOf(scoreWidth, scoreHeight)
  if (!candidate || !winner || !scorer) return nothing

  const gray = new Uint8ClampedArray(scoreWidth * scoreHeight)

  const result = await runBurst({
    frames,
    budgetMs,
    now,
    wait,
    grab: () => {
      if (!video.videoWidth || !video.videoHeight) return null
      candidate!.context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height)
      scorer.context.drawImage(candidate!.canvas, 0, 0, scoreWidth, scoreHeight)
      const { data } = scorer.context.getImageData(0, 0, scoreWidth, scoreHeight)
      return laplacianVariance(toGrayscale(data, gray), scoreWidth, scoreHeight)
    },
    keep: () => {
      // A reference swap, not a copy. The old winner becomes the scratch
      // buffer the next candidate is drawn over.
      const held = winner
      winner = candidate
      candidate = held
    },
  })

  if (result.chosen < 0) return { ...result, image: '' }
  return { ...result, image: winner!.canvas.toDataURL('image/jpeg', 0.92) }
}
