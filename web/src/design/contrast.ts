/**
 * Contrast the way WCAG 2.1 defines it, and the compositing that has to happen
 * before there is anything to measure.
 *
 * **One arithmetic, because there are two tests that measure colour.**
 * `src/styles.test.ts` recomputes the ratios of what the app's own stylesheet
 * floats on the camera, from the digits in the files rather than from a
 * sentence somebody wrote beside them (#432, #451). `design/design.test.tsx`
 * does the same for the bed the design system writes every word on the camera
 * on (#530). Two copies of this would agree until one of them was edited, which
 * is the fault `Shots.tsx` was made to end, and colour is the worst place to
 * have it: a drifted copy is a green test asserting the wrong number.
 *
 * Nothing at run time imports this. It is here rather than beside one of the
 * two tests because it belongs to neither of them.
 *
 * ## What "over a photograph" means, which is the whole reason this exists
 *
 * A ratio needs two colours, and half of what this app draws is floating on a
 * live camera, where the second colour is whatever the lens is pointed at. That
 * looks unanswerable and is not. The lens hands the screen eight-bit sRGB, so
 * the background is a **range with both ends closed**: nothing is lighter than
 * white or darker than black. Measure against `BEHIND` and the answer holds for
 * every book that will ever be held up.
 */

/** A colour with no alpha left in it. */
export type Rgb = [number, number, number]

/** A colour as written in a stylesheet: channels, and how much of them lands. */
export interface Paint {
  rgb: Rgb
  alpha: number
}

/**
 * A `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)` as written in a stylesheet.
 *
 * Deliberately narrow. Anything else throws rather than being guessed at, so a
 * rule that starts writing in a colour space this cannot composite fails the
 * test that reads it instead of being quietly skipped.
 */
export function parse(colour: string): Paint {
  const hex = colour.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1]!.length === 3
      ? hex[1]!.split('').map((c) => c + c).join('')
      : hex[1]!
    return {
      rgb: [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb,
      alpha: 1,
    }
  }

  const rgba = colour.match(/^rgba?\(([^)]+)\)$/)
  if (!rgba) throw new Error(`${colour} is not a colour this test can measure`)
  const parts = rgba[1]!.split(',').map((one) => Number(one.trim()))
  return { rgb: parts.slice(0, 3) as Rgb, alpha: parts[3] ?? 1 }
}

const channel = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

/** The ratio between two colours, larger first, as WCAG states it. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** One paint laid over another, which is what a partly transparent rule does. */
export const over = (top: Paint, under: Rgb): Rgb =>
  top.rgb.map((c, i) => c * top.alpha + under[i]! * (1 - top.alpha)) as Rgb

/** AA for body text. Every word measured by either test is set below 18.66px. */
export const AA_BODY_TEXT = 4.5

/**
 * The two ends of what a camera can put behind something.
 *
 * A white page and a black paperback are both books somebody photographs, and
 * neither is a corner case: the page is most of what this camera sees. Nothing
 * an eight-bit photograph contains is outside them, so a bed that clears both
 * clears everything in between.
 */
export const BEHIND: Rgb[] = [[0, 0, 0], [255, 255, 255]]
