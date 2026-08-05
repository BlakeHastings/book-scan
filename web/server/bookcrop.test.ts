/**
 * How often the detector finds the book, and how often it is wrong.
 *
 * This repository threw a book detector away once for firing on the wrong
 * thing, so "it looked right when I tried it" is not an acceptable answer
 * here. Every scene below is generated with the book's true rectangle known,
 * so accuracy is a number, and the number that matters is the last one: a
 * crop that cuts a cover in half is far worse than no crop, because nobody
 * looks at a photograph twice and the room around a book is a small
 * annoyance next to losing half its cover.
 *
 * What is measured, per scene:
 *
 *   kept   how much of the real book survived the crop. Below 1 means the
 *          crop cut into the book, which is the expensive failure.
 *   iou    overlap with the true rectangle. A high `kept` with a low `iou`
 *          is a crop that contains the book and half the room with it:
 *          useless, but not damaging.
 *
 * The scenes are synthetic and so easier than a phone photograph in ways
 * worth saying out loud: perfectly straight edges, no perspective, no motion
 * blur, and a book that is always fully inside the frame. What they do carry
 * is the backgrounds that break edge detection (a patterned rug, floorboard
 * seams, a background nearly the same tone as the cover), a drop shadow just
 * outside the book, other rectangular objects in shot, and tilt.
 */

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { cropBook, detectBook, type Rect } from './bookcrop'
import {
  backCover, colouredCover, colouredSpine, frontCover, glossy, photographedBook, spine,
  type SceneBackground,
} from './fixtures'

/** How much of the true rectangle the crop kept. 1 is all of it. */
function kept(truth: Rect, crop: Rect): number {
  const overlap = intersect(truth, crop)
  return overlap / (truth.width * truth.height)
}

/** Overlap over union. 1 is an exact match. */
function iou(truth: Rect, crop: Rect): number {
  const overlap = intersect(truth, crop)
  if (!overlap) return 0
  return overlap / (truth.width * truth.height + crop.width * crop.height - overlap)
}

function intersect(a: Rect, b: Rect): number {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right <= left || bottom <= top) return 0
  return (right - left) * (bottom - top)
}

/**
 * A crop is right when it kept the whole book and did not bring most of the
 * room with it. The `kept` bar is the strict one on purpose.
 */
const KEEPS_THE_BOOK = 0.98
const TIGHT_ENOUGH = 0.8

interface Scored {
  name: string
  cropped: boolean
  kept: number
  iou: number
  refusal?: string
}

describe('finding a book in a photograph', () => {
  it('finds it in most frames and crops the wrong thing in none', async () => {
    const front = await frontCover('The Dispossessed', 'Ursula K. Le Guin')
    const back = await backCover('9780441013593')
    const shiny = await glossy(front)

    const subjects = [
      { label: 'front', image: front },
      { label: 'back', image: back },
      { label: 'glossy', image: shiny },
    ]
    const backgrounds: SceneBackground[] = ['carpet', 'floorboards', 'rug', 'plain']

    const scored: Scored[] = []
    let seed = 1

    for (const background of backgrounds) {
      for (const subject of subjects) {
        for (const rotate of [0, -5]) {
          const scene = await photographedBook(subject.image, {
            seed: seed++,
            width: 900,
            height: 1200,
            background,
            fill: background === 'rug' ? 0.4 : 0.55,
            rotate,
            // Something else rectangular in shot, except on the plain
            // background where the hard part is the cover and the wall being
            // nearly the same tone.
            distractors: background === 'plain' ? 0 : 1,
            camouflage: background === 'plain' ? 0.5 : 0,
          })

          const decision = await detectBook(scene.image)
          scored.push({
            name: `${background}/${subject.label}/rot${rotate}`,
            cropped: Boolean(decision.rect),
            kept: decision.rect ? kept(scene.rect, decision.rect) : 0,
            iou: decision.rect ? iou(scene.rect, decision.rect) : 0,
            refusal: decision.refusal,
          })
        }
      }
    }

    const cropped = scored.filter((s) => s.cropped)
    const cutTheBook = cropped.filter((s) => s.kept < KEEPS_THE_BOOK)
    const tooLoose = cropped.filter((s) => s.kept >= KEEPS_THE_BOOK && s.iou < TIGHT_ENOUGH)

    // Written out so a run that regresses says which scenes did it, rather
    // than only that a ratio moved.
    const report = scored
      .map((s) => `${s.name}: ${s.cropped ? `kept ${s.kept.toFixed(3)} iou ${s.iou.toFixed(2)}` : `declined (${s.refusal})`}`)
      .join('\n')

    // Printed, not just asserted. The one thing worth knowing about a
    // detector is its accuracy, and a run that only says "pass" hides it.
    console.log(
      `[bookcrop] ${scored.length} scenes: found ${cropped.length}, `
      + `cut the book ${cutTheBook.length}, kept the room in ${tooLoose.length}`,
    )

    expect(`${cutTheBook.length} cut, ${tooLoose.length} loose\n${report}`)
      .toContain('0 cut')
    // Finding it in three quarters of them is the bar. The measured figure at
    // the time of writing is higher; this is where it stops being worth
    // shipping rather than where it sits.
    expect(cropped.length / scored.length).toBeGreaterThanOrEqual(0.75)
  }, 60_000)

  it('declines a photograph with no book in it rather than inventing one', async () => {
    // A frame of floor. Nothing here is a book and the honest answer is none.
    const speck = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#808080' },
    }).png().toBuffer()

    const refusals: string[] = []
    for (const background of ['carpet', 'floorboards', 'rug'] as SceneBackground[]) {
      const scene = await photographedBook(speck, {
        seed: 401, width: 700, height: 900, background, fill: 0.005, shadow: false,
      })
      const decision = await detectBook(scene.image)
      refusals.push(`${background}: ${decision.rect ? 'cropped' : decision.refusal}`)
    }

    expect(refusals.join('\n')).not.toContain('cropped')
  }, 30_000)

  /**
   * The scenes above are all neutral: a grey floor under a white cover, where
   * the only thing separating them is brightness. The owner's collection is
   * not, and measuring the detector against his photographs said so plainly.
   * The covers that were being found were pale and the ones being missed were
   * dark, in the same room on the same table, which is another way of saying
   * the detector was reading luminance and calling it an object.
   *
   * These three lock in what fixing that took. They are here rather than in the
   * sweep above because each one failed before the change and passes after it,
   * which is the only property that makes a regression test worth its runtime.
   */
  describe('colour, not just brightness', () => {
    /** A warm dark table. Roughly the tone of the wood in the real photographs. */
    const DARK_TABLE: [number, number, number] = [1.15, 0.85, 0.6]

    it('finds a dark cover on a dark table that differs from it in hue', async () => {
      // A cool near-black cover on warm near-black wood. In greyscale these are
      // within a few levels of each other and the step gate threw the book away
      // even though it had located it: this was the single largest category of
      // failure, fourteen of the owner's thirty-six.
      const scene = await photographedBook(
        await colouredCover('Blindsight', 'Peter Watts', '#154048', '#8fa4bb'),
        {
          seed: 71, width: 900, height: 1200, fill: 0.55, rotate: -8,
          background: 'plain', backgroundTint: DARK_TABLE,
        },
      )

      const decision = await detectBook(scene.image)
      expect(decision.refusal ?? 'cropped').toBe('cropped')
      expect(kept(scene.rect, decision.rect!)).toBeGreaterThanOrEqual(KEEPS_THE_BOOK)
    }, 30_000)

    it('crops the book and not the band printed across it', async () => {
      // A dark cover on a dark table with a darker rule ruled across the top of
      // it, which is what the edge of a title bar looks like from above. The
      // book's own outline is faint here, so the printed rule is the strongest
      // straight line in the frame and it steps the same way the cover does
      // against the table, which is enough to pass a gate that only looks at a
      // thin band either side of the line. Measuring the same difference again
      // sixteen pixels out is what rejects it: past the rule the cover is back,
      // so the difference does not keep. Without that reading this scene comes
      // back with 71 per cent of the book, and there is a real photograph in the
      // owner's collection that failed the same way.
      const scene = await photographedBook(
        await colouredCover(
          'Mary Barton', 'E. Gaskell', '#154048', '#8fa4bb',
          { colour: '#0b1c22', thickness: 46, at: 0.28 },
        ),
        {
          seed: 71, width: 900, height: 1200, fill: 0.6, rotate: -8,
          background: 'plain', backgroundTint: DARK_TABLE,
        },
      )

      const decision = await detectBook(scene.image)
      // Declining is allowed. Coming back with the part below the rule is not.
      if (!decision.rect) return
      expect(kept(scene.rect, decision.rect)).toBeGreaterThanOrEqual(KEEPS_THE_BOOK)
    }, 30_000)

    it('finds a spine in the strip shape the phone really saves', async () => {
      // The edge slot saves 511 by 3072 pixels, an aspect of 0.166. The test
      // above it uses 480 by 1360, which is 0.353: more than twice as wide for
      // its height, and comfortably inside a working range the real shape sits
      // outside. Detection scaled that strip to 480 by 2885, and a side swept
      // through eight degrees of tilt in a frame that tall moves 405 pixels
      // sideways in a frame 480 wide, so the tilts on offer were both mostly
      // off the picture and a hundred pixels apart. A spine an inch out of
      // square in a hand landed between two of them and was measured smeared.
      const scene = await photographedBook(
        await colouredSpine('The Dispossessed', '#c8b48a', '#2a2118'),
        {
          seed: 77, width: 511, height: 3072, fill: 0.55, rotate: -2,
          background: 'plain', backgroundTint: DARK_TABLE,
        },
      )

      const decision = await detectBook(scene.image)
      expect(decision.refusal ?? 'cropped').toBe('cropped')
      expect(kept(scene.rect, decision.rect!)).toBeGreaterThanOrEqual(KEEPS_THE_BOOK)
    }, 30_000)
  })

  it('declines a flat frame instead of dividing by nothing', async () => {
    const flat = await sharp({
      create: { width: 600, height: 800, channels: 3, background: '#7a7a7a' },
    }).jpeg().toBuffer()

    const decision = await detectBook(flat)
    expect(decision.rect).toBeNull()
    expect(decision.confidence).toBe(0)
  })

  it('keeps the rectangle inside the photograph', async () => {
    // The book runs right up to one edge, which is where an outward pad or a
    // line snapped past the border would put the crop off the canvas and make
    // sharp throw rather than decline.
    const scene = await photographedBook(
      await frontCover('Edge Case', 'A. Author'),
      { seed: 9, width: 700, height: 950, fill: 0.95, background: 'carpet' },
    )

    const decision = await detectBook(scene.image)
    if (!decision.rect) return // declining is a valid answer here

    expect(decision.rect.left).toBeGreaterThanOrEqual(0)
    expect(decision.rect.top).toBeGreaterThanOrEqual(0)
    expect(decision.rect.left + decision.rect.width).toBeLessThanOrEqual(700)
    expect(decision.rect.top + decision.rect.height).toBeLessThanOrEqual(950)
  }, 20_000)

  it('reads the orientation tag, so a portrait photo is not detected sideways', async () => {
    const scene = await photographedBook(
      await frontCover('Sideways', 'A. Author'),
      { seed: 12, width: 900, height: 1200, fill: 0.5, background: 'carpet' },
    )

    // The same pixels, tagged as needing a quarter turn. A detector that
    // ignored the tag would hand back a rectangle in the wrong axis, and
    // sharp, which does honour it, would then extract the wrong strip.
    const tagged = await sharp(scene.image).withMetadata({ orientation: 6 }).jpeg().toBuffer()

    const result = await cropBook(tagged)
    expect(result.rect).not.toBeNull()

    // .rotate() turns it to 1200 wide by 900 tall before extracting.
    const meta = await sharp(result.image!).metadata()
    expect(meta.width).toBeLessThanOrEqual(1200)
    expect(meta.height).toBeLessThanOrEqual(900)
  }, 20_000)
})

describe('cropBook', () => {
  it('hands back a new image and never the one it was given', async () => {
    const scene = await photographedBook(
      await frontCover('Kindred', 'Octavia E. Butler'),
      { seed: 21, width: 900, height: 1200, fill: 0.5, background: 'carpet' },
    )

    const before = Buffer.from(scene.image)
    const result = await cropBook(scene.image)

    expect(result.image).not.toBeNull()
    expect(result.image!.equals(scene.image)).toBe(false)
    // The buffer it was handed is untouched. Every path that writes a file
    // starts from a buffer like this one.
    expect(scene.image.equals(before)).toBe(true)

    const meta = await sharp(result.image!).metadata()
    expect(meta.width).toBe(result.rect!.width)
    expect(meta.height).toBe(result.rect!.height)
  }, 20_000)

  it('returns no image, and says why, when it cannot find the book', async () => {
    const flat = await sharp({
      create: { width: 500, height: 700, channels: 3, background: '#606060' },
    }).jpeg().toBuffer()

    const result = await cropBook(flat)
    expect(result.image).toBeNull()
    expect(result.refusal).toBeTruthy()
  })

  it('finds a spine inside the strip the capture guide already saved', async () => {
    // The edge slot is cropped at capture to SPINE_CROP, so what arrives is a
    // tall narrow frame with the spine in it and a margin of room either
    // side. That margin is all there is left to gain here.
    const scene = await photographedBook(
      await spine('The Dispossessed', 'Le Guin'),
      { seed: 31, width: 480, height: 1360, fill: 0.7, background: 'carpet' },
    )

    const decision = await detectBook(scene.image)
    expect(decision.rect).not.toBeNull()
    expect(kept(scene.rect, decision.rect!)).toBeGreaterThanOrEqual(KEEPS_THE_BOOK)
  }, 20_000)
})
