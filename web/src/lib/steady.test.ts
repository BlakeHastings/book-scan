/**
 * The sharpest-frame choice.
 *
 * This is the part of steadying a shot that can silently stop working. If the
 * scoring drifts, or the burst quietly keeps the last frame instead of the
 * best one, every photo still arrives and nothing anywhere reports an error;
 * the only symptom is that blurred spines come back a bit more often, months
 * later, in someone else's hands. So the choice is pinned here rather than
 * left to be noticed.
 */

import { describe, expect, it } from 'vitest'
import {
  BURST_FRAMES, laplacianVariance, runBurst, sharpestIndex, toGrayscale,
} from './steady'

/**
 * A grey field with a hard black/white edge down the middle: maximum second
 * derivative at one column, nothing anywhere else.
 */
function edgeImage(width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gray[y * width + x] = x < width / 2 ? 0 : 255
    }
  }
  return gray
}

/**
 * The same edge smeared across `spread` columns, which is what motion blur
 * does to it: the step becomes a ramp and the second derivative flattens.
 */
function blurredEdgeImage(width: number, height: number, spread: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height)
  const middle = width / 2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x - middle) / spread + 0.5
      gray[y * width + x] = Math.max(0, Math.min(1, t)) * 255
    }
  }
  return gray
}

describe('laplacianVariance', () => {
  it('is zero for a flat field, which has no detail to measure', () => {
    const flat = new Uint8ClampedArray(40 * 40).fill(128)
    expect(laplacianVariance(flat, 40, 40)).toBe(0)
  })

  it('scores a sharp edge above the same edge blurred', () => {
    const sharp = laplacianVariance(edgeImage(64, 64), 64, 64)
    const blurred = laplacianVariance(blurredEdgeImage(64, 64, 8), 64, 64)
    expect(sharp).toBeGreaterThan(blurred)
  })

  it('falls monotonically as the same edge is smeared further', () => {
    // The whole premise of picking a frame: more motion during the exposure
    // has to read as a lower score, not merely a different one.
    const scores = [2, 4, 8, 16].map((spread) =>
      laplacianVariance(blurredEdgeImage(64, 64, spread), 64, 64),
    )
    const descending = [...scores].sort((a, b) => b - a)
    expect(scores).toEqual(descending)
  })

  it('returns zero rather than throwing on an image too small to have an interior', () => {
    expect(laplacianVariance(new Uint8ClampedArray(4), 2, 2)).toBe(0)
  })
})

describe('toGrayscale', () => {
  it('weights green most, as luma does', () => {
    const green = toGrayscale(new Uint8ClampedArray([0, 255, 0, 255]))[0]!
    const red = toGrayscale(new Uint8ClampedArray([255, 0, 0, 255]))[0]!
    const blue = toGrayscale(new Uint8ClampedArray([0, 0, 255, 255]))[0]!
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  it('reuses the buffer it is handed, so a burst allocates once', () => {
    const buffer = new Uint8ClampedArray(2)
    const out = toGrayscale(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), buffer)
    expect(out).toBe(buffer)
    expect(Math.round(buffer[0]!)).toBe(255)
    expect(buffer[1]).toBe(0)
  })
})

describe('sharpestIndex', () => {
  it('picks the highest score', () => {
    expect(sharpestIndex([1, 9, 3])).toBe(1)
  })

  it('picks the first of equal scores rather than drifting to the last', () => {
    expect(sharpestIndex([5, 5, 5])).toBe(0)
  })

  it('reports -1 when nothing was scored', () => {
    expect(sharpestIndex([])).toBe(-1)
  })
})

/** A burst driven by a fixed list of scores, with no camera and no clock. */
function burstOver(scores: (number | null)[], options: { budgetMs?: number; step?: number } = {}) {
  const { budgetMs = 10_000, step = 33 } = options
  let index = 0
  let clock = 0
  const kept: number[] = []

  return {
    kept,
    run: () =>
      runBurst({
        frames: scores.length,
        budgetMs,
        now: () => clock,
        wait: () => { clock += step; return Promise.resolve() },
        grab: () => scores[index++] ?? null,
        keep: () => kept.push(index - 1),
      }),
  }
}

describe('runBurst', () => {
  it('keeps the sharpest frame, not the last one', async () => {
    // The sharp frame is in the middle, so "keep the last" and "keep the best"
    // give different answers and the test can tell them apart.
    const burst = burstOver([10, 90, 20, 15, 30])
    const result = await burst.run()

    expect(result.chosen).toBe(1)
    expect(result.scores).toEqual([10, 90, 20, 15, 30])
    // The winning frame was the last one handed to `keep`, so what gets
    // encoded really is the frame that scored 90.
    expect(burst.kept.at(-1)).toBe(1)
  })

  it('keeps the sharpest frame, not the first one', async () => {
    const burst = burstOver([10, 20, 90, 15, 30])
    expect((await burst.run()).chosen).toBe(2)
    expect(burst.kept.at(-1)).toBe(2)
  })

  it('only holds on to a frame that actually beat the best so far', async () => {
    // Every call to keep is a full-resolution buffer swap. Frames that lose
    // must not trigger one, or the burst does needless work per frame.
    const burst = burstOver([10, 90, 20, 15, 30])
    await burst.run()
    expect(burst.kept).toEqual([0, 1])
  })

  it('always keeps something when at least one frame arrived', async () => {
    const burst = burstOver([7])
    const result = await burst.run()
    expect(result.chosen).toBe(0)
    expect(burst.kept).toEqual([0])
  })

  it('reports nothing chosen when the camera produced no frame at all', async () => {
    const burst = burstOver([null, null])
    const result = await burst.run()
    expect(result.chosen).toBe(-1)
    expect(result.scores).toEqual([])
    expect(burst.kept).toEqual([])
  })

  it('scores frames that arrive and ignores the gaps', async () => {
    const burst = burstOver([10, null, 90, null])
    const result = await burst.run()
    expect(result.scores).toEqual([10, 90])
    expect(result.chosen).toBe(1)
  })

  it('stops once the budget is spent rather than waiting for the frame count', async () => {
    // Somebody photographing forty books pays this per shot. A camera handing
    // back frames slowly must shorten the burst, not lengthen the shutter.
    const burst = burstOver([1, 2, 3, 4, 5, 6, 7], { budgetMs: 100, step: 40 })
    const result = await burst.run()
    expect(result.scores.length).toBeLessThan(7)
    expect(result.elapsedMs).toBeLessThanOrEqual(120)
  })

  it('does not wait after the final frame', async () => {
    // The wait between frames is the whole cost of the burst, so a trailing
    // one is a shutter delay bought for nothing.
    const burst = burstOver([1, 2, 3], { step: 33 })
    const result = await burst.run()
    expect(result.elapsedMs).toBe(66)
  })

  it('spans long enough at 30fps to contain a tremor turning point', async () => {
    // The reason the burst is the length it is. Tremor starts around 4Hz and
    // the hand reverses twice per cycle, so any window of at least half the
    // slowest period, 125ms, has to contain a moment where it is turning round
    // and briefly almost still. That moment is the sharp frame. A burst
    // shortened below this stops being able to promise it caught one.
    const burst = burstOver(Array.from({ length: BURST_FRAMES }, (_, i) => i), { step: 33 })
    const result = await burst.run()
    expect(result.elapsedMs).toBeGreaterThanOrEqual(125)
  })

  it('does not run so long that a shot costs a noticeable pause', async () => {
    // The other side of the same trade: somebody photographing forty books
    // pays this a hundred and twenty times.
    const burst = burstOver(Array.from({ length: BURST_FRAMES }, (_, i) => i), { step: 33 })
    expect((await burst.run()).elapsedMs).toBeLessThanOrEqual(200)
  })
})
