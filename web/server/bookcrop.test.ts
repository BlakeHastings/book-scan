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
 *   clear  how far the crop's nearest side sits outside the book, over the
 *          book's own short side. This is `kept` with the saturation taken
 *          out: `kept` is 1.0000 on every scene here and stays 1.0000 until a
 *          crop cuts, so on its own it is a pass or fail rather than a
 *          reading. `clear` says how near the cut we came, and it goes
 *          negative one pixel before `kept` moves at all.
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
 *
 * Every bar below was measured before it was written, and the measurements are
 * recorded next to the number they justify. A threshold picked so the suite
 * goes green is not a test, and a constant that is computed and printed but
 * never asserted is documentation wearing a test's clothes: both were true of
 * this file and #131 is why they are not now.
 */

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { MIN_PROMINENCE, MIN_STEP, cropBook, detectBook, type CropDecision, type Rect } from './bookcrop'
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

/**
 * The nearest the crop came to the book, over the book's short side.
 *
 * Positive means every side of the crop lies outside the book with room to
 * spare; zero means one side is on the book's own edge; negative means it cut.
 * This exists because `kept` cannot tell a crop that cleared the book by a
 * comfortable margin from one that cleared it by a single pixel, and those are
 * not the same detector.
 */
function clearance(truth: Rect, crop: Rect): number {
  return Math.min(
    truth.left - crop.left,
    truth.top - crop.top,
    (crop.left + crop.width) - (truth.left + truth.width),
    (crop.top + crop.height) - (truth.top + truth.height),
  ) / Math.min(truth.width, truth.height)
}

function intersect(a: Rect, b: Rect): number {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right <= left || bottom <= top) return 0
  return (right - left) * (bottom - top)
}

function inside(rect: Rect, width: number, height: number): boolean {
  return rect.left >= 0 && rect.top >= 0
    && rect.left + rect.width <= width && rect.top + rect.height <= height
}

/** The weakest of the four sides, which is what the decision turned on. */
function worstProminence(decision: CropDecision): number {
  const p = decision.prominence!
  return Math.min(p.left, p.right, p.top, p.bottom)
}

/**
 * A crop is right when it kept the whole book and did not bring most of the
 * room with it. The `kept` bar is the strict one on purpose.
 */
const KEEPS_THE_BOOK = 0.98

/**
 * ...and how much daylight there has to be between the crop and the book.
 *
 * `kept` reads 1.0000 on all twenty-four scenes in the sweep, so on its own it
 * says nothing until a crop actually cuts. Measured clearances across the sweep
 * run from 0.0072 to 0.0156 of the book's short side, which is the 1.5 per cent
 * outward pad arriving as it should. The bar is 0.004: below zero a crop is
 * cutting, and 0.004 is comfortably under the tightest scene measured while
 * still failing loudly if the pad were dropped, which would put every scene
 * between -0.008 and -0.001.
 */
const CLEAR_ENOUGH = 0.004

/**
 * How much of the crop has to be book rather than room.
 *
 * This was 0.8, computed and printed and never asserted, and #131 is the
 * decision it was deferring. Asserting 0.8 was the wrong move twice over.
 *
 * The measured scores fall into two populations with nothing between them. The
 * twenty-two scenes where the detector finds the book's own four edges score
 * 0.9387 to 0.9496, the spread being the outward pad. Two scenes score 0.8234
 * and 0.7627, and they fail the same way: on floorboards the bottom side snaps
 * onto a plank seam below the book instead of the book's own bottom edge, so
 * the crop takes in a strip of floor. See KNOWN_LOOSE.
 *
 * So 0.8 sat inside the loose population rather than above it. It would have
 * passed one seam-snapped crop at 0.8234 while failing the other at 0.7627,
 * which is not a distinction the number was drawing on purpose, and a scene
 * that clears a bar by 0.023 is a scene that flips on somebody else's machine.
 * 0.88 sits in the gap between the two populations, the same reasoning that put
 * MIN_STEP at 4 in `bookcrop.ts`, and it is stricter than 0.8 everywhere except
 * the two scenes that are now named and bounded rather than silently tolerated.
 */
const TIGHT_ENOUGH = 0.88

/** ...and the floor under a scene that is a recorded limitation. */
const HOLDS_THE_BOOK = 0.7

/**
 * Scenes measured below TIGHT_ENOUGH, with what they score and why.
 *
 * These are recorded limitations, not a quieter bar. Both are the floorboard
 * seam: the fixture draws a dark seam every 130 pixels, and the bottom side of
 * the crop lands on the seam below the book rather than on the book. Verified
 * by re-running both scenes with `distractors: 0`, which changes nothing, and
 * by the arithmetic: `floorboards/back/rot0` crops to a bottom edge of 1050
 * where the book ends at 941 and a seam sits at 1040, and
 * `floorboards/glossy/rot-5` crops to 1053 where the book ends at 899 and the
 * same seam sits at 1040.
 *
 * Both keep 1.0000 of the book, so this is a crop with a strip of floor in it
 * rather than a damaged cover, which is the trade this detector is explicitly
 * built to make. They are listed so that a change which fixed them shows up as
 * a scene that no longer needs to be here, and a change which made them worse
 * still fails at HOLDS_THE_BOOK.
 */
const KNOWN_LOOSE: Record<string, string> = {
  'floorboards/back/rot0': 'iou 0.8234: bottom side snapped to the plank seam at y=1040',
  'floorboards/glossy/rot-5': 'iou 0.7627: bottom side snapped to the plank seam at y=1040',
}

interface Scored {
  name: string
  cropped: boolean
  kept: number
  clearance: number
  iou: number
  inside: boolean
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
            clearance: decision.rect ? clearance(scene.rect, decision.rect) : 0,
            iou: decision.rect ? iou(scene.rect, decision.rect) : 0,
            inside: decision.rect ? inside(decision.rect, 900, 1200) : true,
            refusal: decision.refusal,
          })
        }
      }
    }

    const cropped = scored.filter((s) => s.cropped)

    // Every scene is judged against the bar that applies to it, and a scene
    // that is a recorded limitation is judged against its own floor rather
    // than excused. Named, so a run that regresses says which scenes did it
    // rather than only that a ratio moved.
    const failures = [
      ...cropped.filter((s) => s.kept < KEEPS_THE_BOOK)
        .map((s) => `cut the book: ${s.name} kept ${s.kept.toFixed(4)}`),
      ...cropped.filter((s) => s.clearance < CLEAR_ENOUGH)
        .map((s) => `came too near the book: ${s.name} clear ${s.clearance.toFixed(4)}`),
      ...cropped.filter((s) => !s.inside)
        .map((s) => `rectangle left the picture: ${s.name}`),
      ...cropped.filter((s) => s.iou < (s.name in KNOWN_LOOSE ? HOLDS_THE_BOOK : TIGHT_ENOUGH))
        .map((s) => `kept the room in: ${s.name} iou ${s.iou.toFixed(4)}`
          + (s.name in KNOWN_LOOSE ? ` (recorded limitation, floor ${HOLDS_THE_BOOK})` : '')),
    ]

    const report = scored
      .map((s) => `${s.name}: ${s.cropped
        ? `kept ${s.kept.toFixed(4)} clear ${s.clearance.toFixed(4)} iou ${s.iou.toFixed(4)}`
        : `declined (${s.refusal})`}`)
      .join('\n')

    // Printed, not just asserted. The one thing worth knowing about a
    // detector is its accuracy, and a run that only says "pass" hides it.
    const tightest = Math.min(...cropped.map((s) => s.clearance))
    const loosest = Math.min(...cropped.map((s) => s.iou))
    console.log(
      `[bookcrop] ${scored.length} scenes: found ${cropped.length}, `
      + `nearest miss clear ${tightest.toFixed(4)}, worst iou ${loosest.toFixed(4)}, `
      + `${Object.keys(KNOWN_LOOSE).length} recorded limitations`,
    )

    // The report goes on both sides so a failure prints the whole table next
    // to the scenes that broke, rather than a bare list of names.
    expect({ failures, report }).toEqual({ failures: [], report })

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

    const decisions = new Map<SceneBackground, CropDecision>()
    for (const background of ['carpet', 'floorboards', 'rug'] as SceneBackground[]) {
      const scene = await photographedBook(speck, {
        seed: 401, width: 700, height: 900, background, fill: 0.005, shadow: false,
      })
      decisions.set(background, await detectBook(scene.image))
    }

    const outcomes = Object.fromEntries(
      [...decisions].map(([background, d]) => [background, d.rect ? 'cropped' : d.refusal]),
    )

    // Which refusal, not just that there was one. The three frames are turned
    // down by two different parts of the pipeline and the file used to assert
    // only that none of them cropped, which cannot tell the difference.
    expect(outcomes).toEqual({
      carpet: 'weak-edges',
      floorboards: 'weak-edges',
      rug: 'low-contrast',
    })

    // The rug is the case worth spelling out, and it was the fourth thing #131
    // listed. A rug's repeat gives the snapping search a rectangle it is very
    // happy with: the weakest side stands 12.6 times above the typical line in
    // its own band, against a bar of 2.6. Nothing about the geometry rejects
    // this frame. The only thing that does is the step gate finding no
    // direction in Lab along which all four sides move the same way, and it
    // finds exactly none: the frame scores 0 against a bar of 4.
    //
    // Asserted here so that a change to that gate fails this test with the
    // reason attached, rather than quietly removing the one thing keeping a
    // photograph of somebody's floor from being cropped as a book.
    const rug = decisions.get('rug')!
    expect(worstProminence(rug)).toBeGreaterThan(MIN_PROMINENCE)
    expect(rug.step).toBeLessThan(MIN_STEP)

    // ...and the other two are the opposite case, held up before the step gate
    // is ever reached, which is why they say `weak-edges` instead.
    expect(worstProminence(decisions.get('carpet')!)).toBeLessThan(MIN_PROMINENCE)
    expect(worstProminence(decisions.get('floorboards')!)).toBeLessThan(MIN_PROMINENCE)
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

      // This used to return early when there was no rectangle, on the grounds
      // that declining is allowed here. It is, but nobody had measured which
      // way this scene goes, so the test asserted nothing on the branch it
      // actually takes and would also have passed if the detector had started
      // declining everything. Measured: it crops, and not narrowly. The
      // weakest side stands 11.3 times above its band against a bar of 2.6,
      // and the four sides agree to 11.3 in Lab against a bar of 4, so there
      // is no near-tie here to flip on another machine.
      expect(decision.refusal ?? 'cropped').toBe('cropped')
      expect(worstProminence(decision)).toBeGreaterThan(MIN_PROMINENCE)
      expect(decision.step).toBeGreaterThan(MIN_STEP)
      // Coming back with the part below the rule is what this is really for.
      // That crop keeps 0.71 of the book, so the bar catches it with room.
      expect(kept(scene.rect, decision.rect!)).toBeGreaterThanOrEqual(KEEPS_THE_BOOK)
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
    expect(decision.refusal).toBe('no-edges')
    expect(decision.confidence).toBe(0)
  })

  it('keeps the rectangle inside the photograph', async () => {
    const scene = await photographedBook(
      await frontCover('Edge Case', 'A. Author'),
      { seed: 9, width: 700, height: 950, fill: 0.95, background: 'carpet' },
    )

    const decision = await detectBook(scene.image)

    // This used to return early when there was no rectangle, which made every
    // assertion below optional. It crops, with the weakest side 16.2 times
    // above its band against a bar of 2.6, so the outcome is asserted rather
    // than allowed for. `fill: 0.95` asks for a book most of the frame wide,
    // which the fixture then fits to the frame's height, so the book does not
    // in fact reach the border here. The scene where it does is the next test,
    // and the answer there is a refusal.
    expect(decision.refusal ?? 'cropped').toBe('cropped')
    expect(kept(scene.rect, decision.rect!)).toBeGreaterThanOrEqual(KEEPS_THE_BOOK)

    expect(decision.rect!.left).toBeGreaterThanOrEqual(0)
    expect(decision.rect!.top).toBeGreaterThanOrEqual(0)
    expect(decision.rect!.left + decision.rect!.width).toBeLessThanOrEqual(700)
    expect(decision.rect!.top + decision.rect!.height).toBeLessThanOrEqual(950)
  }, 20_000)

  it('declines a book flush against the border rather than snapping past it', async () => {
    // The hazard the test above describes but does not reach: a book whose edge
    // is the picture's edge, where an outward pad or a line snapped past the
    // border would put the crop off the canvas and make sharp throw rather than
    // decline. Cut out of an ordinary scene so the book's left edge is column
    // zero.
    //
    // Declining is the right answer and is what happens, for a reason in the
    // detector rather than by luck: a side whose outer sampling band falls off
    // the picture has not been measured, `labStep` returns null rather than
    // scoring it as no difference, and a frame with an unmeasured side cannot
    // clear the step gate. Measured at three placements, the step is 0.00 every
    // time. Which refusal comes back depends on whether the surviving geometry
    // still looked like an edge, so both are allowed here.
    const scene = await photographedBook(
      await frontCover('Edge Case', 'A. Author'),
      { seed: 9, width: 900, height: 1200, fill: 0.5, background: 'carpet' },
    )
    const height = Math.min(1200, scene.rect.height + 260)
    const top = Math.max(0, Math.min(1200 - height, scene.rect.top - 130))
    const flush = await sharp(scene.image)
      .extract({
        left: scene.rect.left,
        top,
        width: Math.min(900 - scene.rect.left, scene.rect.width + 260),
        height,
      })
      .jpeg({ quality: 92 })
      .toBuffer()

    const decision = await detectBook(flush)
    expect(decision.rect).toBeNull()
    expect(['weak-edges', 'low-contrast']).toContain(decision.refusal)
    expect(decision.step).toBeLessThan(MIN_STEP)

    // And the caller gets a refusal rather than a thrown extract.
    const result = await cropBook(flush)
    expect(result.image).toBeNull()
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

    const upright = await detectBook(scene.image)
    const turned = await detectBook(tagged)
    expect(turned.rect).not.toBeNull()

    // The assertion this test used to make was that the cropped image came back
    // no wider than 1200 and no taller than 900. Every crop of a 1200 by 900
    // frame satisfies that, including one that misses the book, so it proved
    // nothing. The axis is the discriminating property: the book stands upright
    // in the stored pixels and lies on its side once the tag is applied, so the
    // rectangle has to be landscape here and portrait without the tag.
    expect(turned.rect!.width).toBeGreaterThan(turned.rect!.height)
    expect(upright.rect!.height).toBeGreaterThan(upright.rect!.width)

    // ...and it has to be a rectangle in the turned frame, 1200 by 900.
    expect(inside(turned.rect!, 1200, 900)).toBe(true)

    const result = await cropBook(tagged)
    const meta = await sharp(result.image!).metadata()
    expect(meta.width).toBe(result.rect!.width)
    expect(meta.height).toBe(result.rect!.height)

    // The rectangle has to hold the book, and that is the assertion this test
    // was missing. #131 left it out on purpose: the axis was right and the
    // rectangle was inside the frame, but it kept 0.3973 of the book, and
    // pinning that number would have frozen #132 in place.
    //
    // The truth rectangle to judge it against is the fixture's own, turned the
    // way the tag says. Orientation 6 means a quarter turn clockwise for
    // display, so a point at (x, y) in the 900 by 1200 stored pixels lands at
    // (1200 - 1 - y, x) in the 1200 by 900 frame the detector works in, and the
    // rectangle transposes with it. Confirmed rather than assumed: rotating the
    // same pixels for real instead of by tag returns {367, 203, 695, 461},
    // which keeps 1.0000 of this rectangle.
    //
    // Before #132 was fixed this read 0.3973, because `toGrey` took its source
    // dimensions from `sharp(input).rotate().metadata()`, which reports the
    // image as stored and not as `.rotate()` will produce it. The scale was
    // 900/480 where the truth is 1200/480, so every EXIF-rotated photograph
    // came back short by exactly the ratio of the frame's two sides.
    const truth: Rect = {
      left: 1200 - (scene.rect.top + scene.rect.height),
      top: scene.rect.left,
      width: scene.rect.height,
      height: scene.rect.width,
    }
    expect(kept(truth, turned.rect!)).toBeGreaterThanOrEqual(KEEPS_THE_BOOK)
    // ...and with the same daylight around it as every other scene here, so a
    // scale that was merely close would not pass either.
    expect(clearance(truth, turned.rect!)).toBeGreaterThanOrEqual(CLEAR_ENOUGH)
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
    expect(result.refusal).toBe('no-edges')
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
