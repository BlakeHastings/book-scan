/**
 * The widths a photograph may be asked for at, by `?w=` on `/api/covers/:name`.
 *
 * A closed set, because the width is in a URL and a URL is a request anybody
 * can make: an open one would let a caller fill the disk with the catalogue at a
 * hundred sizes nothing will ever draw. 1280 is a phone's screen at full size,
 * for the picture opened whole. Ascending, which `widthFor` relies on.
 */
export const VARIANT_WIDTHS = [160, 320, 480, 640, 1280] as const

export type VariantWidth = (typeof VARIANT_WIDTHS)[number]

export function isVariantWidth(width: number): width is VariantWidth {
  return (VARIANT_WIDTHS as readonly number[]).includes(width)
}

/** The smallest width that covers `pixels` device pixels, or the largest there is. */
export function widthFor(pixels: number): VariantWidth {
  return VARIANT_WIDTHS.find((width) => width >= pixels) ?? VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]!
}
