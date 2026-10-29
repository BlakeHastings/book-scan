/**
 * The address of a photograph, at whatever size it is about to be drawn.
 *
 * Every photograph is stored at the size the camera took it, up to eight
 * megapixels, and the server answers any of `VARIANT_WIDTHS` smaller. These
 * read any `/api/covers/` address, with or without a width already on it, so a
 * caller that only has the original's address still downloads a copy its size.
 */

import { VARIANT_WIDTHS, widthFor, type VariantWidth } from '../../shared/photos'

const COVERS = '/api/covers/'

/** The photograph's filename, or null when this is not one of ours (a camera frame, a catalogue's own address). */
export function photoName(src: string): string | null {
  if (!src.startsWith(COVERS)) return null
  const encoded = src.slice(COVERS.length).split(/[?#]/)[0] ?? ''
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

/** The whole photograph, exactly as stored. */
export function originalOf(src: string): string {
  const name = photoName(src)
  return name === null ? src : `${COVERS}${encodeURIComponent(name)}`
}

export function variantOf(name: string, width: VariantWidth): string {
  return `${COVERS}${encodeURIComponent(name)}?w=${width}`
}

export interface Sized {
  src: string
  srcSet?: string
  sizes?: string
}

/**
 * What an `<img>` needs to fetch no more than it draws. `drawn` is the CSS
 * width the picture covers, or for a picture cut to a box by `object-fit:
 * cover`, the box's longer side, since that is what decides how many of the
 * photograph's pixels show. `sizes` may be given instead, as a media list.
 *
 * `src` is the one an `<img>` without `srcset` support falls back to: twice the
 * drawn width, which is what most phones need.
 */
export function sized(src: string, drawn: number, sizes?: string): Sized {
  const name = photoName(src)
  if (name === null) return { src }
  return {
    src: variantOf(name, widthFor(drawn * 2)),
    srcSet: VARIANT_WIDTHS.map((width) => `${variantOf(name, width)} ${width}w`).join(', '),
    sizes: sizes ?? `${Math.ceil(drawn)}px`,
  }
}
