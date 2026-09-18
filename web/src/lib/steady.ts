/**
 * Keeping the sharpest frame of a short burst, so a shaky hand still lands a
 * readable photo.
 *
 * iOS exposes no exposure control or stabilisation call on a capture source,
 * so which frame is kept is the only lever available.
 *
 * Deliberately avoids DeviceMotion: iOS requires a separate permission
 * prompt for it, and the frames already being drawn carry the same
 * information.
 */

import { cropToSource, type CaptureOptions } from './scanner'

/**
 * How many frames a burst examines. Tuned from measurement: each extra frame
 * costs wall time waiting on the camera, not on compute, and five is enough
 * to reliably span a tremor's turning point.
 */
export const BURST_FRAMES = 5

/**
 * A safety net, not the usual control: on a fast enough camera the frame
 * count above ends the burst first. It stops the burst asking for another
 * frame; it cannot cut short a wait already begun, so a burst can overrun
 * this by one frame interval.
 */
export const BURST_BUDGET_MS = 250

/**
 * Width the sharpness score is measured at. Blur survives downscaling since
 * it is a low-frequency property, while sensor noise does not, so the small
 * copy is both cheaper and a slightly better discriminator than the
 * original.
 */
export const SCORE_WIDTH = 240

/** Rec. 601 luma. */
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
 * Variance of the Laplacian. Higher is crisper: a blurred image's high
 * frequencies are gone, so the second derivative is small everywhere and
 * the variance collapses.
 *
 * Only interior pixels are summed. Extrapolating the border would invent
 * edges that no two frames of a burst would agree on.
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
 * Which frame of a burst to keep. Highest score wins; ties go to the
 * earliest, so identical scores (a stalled camera repeating a frame) settle
 * on the first rather than the last.
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
 * The frame handling is injected so the choice can be tested without a
 * camera, a canvas or a clock.
 *
 * `keep` is called as the burst runs rather than once at the end: a video
 * element only ever offers the frame it is showing now, so there is no way
 * to go back for an earlier one.
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

    // Never wait after the last frame, and stop early once the budget is spent.
    if (index === frames - 1 || now() - started >= budgetMs) break
    await wait()
  }

  return { scores, chosen, elapsedMs: now() - started }
}

/** What the last burst did, in words somebody can read off a phone over a call. */
export function describeBurst(scores: readonly number[], chosen: number, elapsedMs: number): string {
  if (!scores.length || chosen < 0) return ''

  const best = scores[chosen]!
  const worst = Math.min(...scores)
  const frames = `${scores.length} frame${scores.length === 1 ? '' : 's'}`
  const took = `${Math.round(elapsedMs)}ms`

  if (scores.length === 1) return `Best of ${frames} in ${took}.`

  // Against the worst, not the average: that is the frame an unlucky single
  // tap would have kept.
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
 * `requestVideoFrameCallback` fires per decoded video frame; without it a
 * burst could score the same frame more than once. Safari has had it since
 * 15.4; `requestAnimationFrame` is the fallback and is only display-paced,
 * so it can repeat a frame.
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
 * Take a short burst and return the sharpest frame as a JPEG data URL. Same
 * crop and encoding as `captureStill`, so nothing downstream can tell the
 * difference except that the picture is less likely to be blurred.
 * Resolution and JPEG quality are untouched on purpose: the spine crop is
 * already down to a few hundred source pixels across, and trading any of
 * them for steadiness would cost the ISBN.
 *
 * Two full-size buffers are swapped by reference rather than copied, so a
 * burst of any length only ever holds two frames, and only the winner is
 * ever JPEG encoded.
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

  // Measured once and reused for every frame: a crop that shifted between
  // frames would be scoring different pictures against each other.
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
      const held = winner
      winner = candidate
      candidate = held
    },
  })

  if (result.chosen < 0) return { ...result, image: '' }
  return { ...result, image: winner!.canvas.toDataURL('image/jpeg', 0.92) }
}
