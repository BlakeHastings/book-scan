/**
 * Contrast the way WCAG 2.1 defines it, and the compositing that has to happen
 * before there is anything to measure.
 *
 * Shared by two tests, `src/styles.test.ts` and `design/design.test.tsx`, both
 * of which recompute ratios from the actual colour digits rather than trusting
 * a comment, so this stays one arithmetic rather than two copies that could
 * drift. Nothing at run time imports it.
 *
 * A ratio needs two colours, but half of what this app draws floats on a live
 * camera, where the second colour is whatever the lens is pointed at. The lens
 * hands the screen eight-bit sRGB, so the background is a range with both ends
 * closed: nothing is lighter than white or darker than black. Measuring
 * against `BEHIND` therefore holds for every book that will ever be held up.
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
 * Deliberately narrow: anything else throws rather than being guessed at.
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
 * AA for something you have to be able to make out and do not have to read
 * (WCAG 1.4.11): the camera's aiming frame, which carries no words.
 */
export const AA_NON_TEXT = 3

/** The two ends of what a camera can put behind something: a bed that clears both clears everything an eight-bit photograph can contain. */
export const BEHIND: Rgb[] = [[0, 0, 0], [255, 255, 255]]
