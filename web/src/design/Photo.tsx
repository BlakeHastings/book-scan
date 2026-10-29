/**
 * A photograph, drawn at no more bytes than the room it is given.
 *
 * Every picture of a book in the app goes through this rather than a bare
 * `<img>`: handed the address of a stored photograph, original or not, it asks
 * for the copy that fits (`lib/photos.ts`). Anything else, a camera frame or a
 * catalogue's own address, is drawn as given.
 */

import { sized } from '../lib/photos'

export function Photo({
  src,
  drawn,
  sizes,
  className,
  alt = '',
  eager = false,
}: {
  src: string
  /** The CSS pixels it covers; for a picture cut to a box, the box's longer side. */
  drawn: number
  /** A media list, where one number will not do (a picture as wide as the screen). */
  sizes?: string
  className?: string
  alt?: string
  /** On screen the moment it is drawn, like the one picture a book's page opens on. */
  eager?: boolean
}) {
  const picked = sized(src, drawn, sizes)
  return (
    // `loading`, `sizes` and `srcSet` ahead of `src`: React writes attributes
    // in this order, and a browser may start on `src` the moment it is set.
    <img
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      sizes={picked.sizes}
      srcSet={picked.srcSet}
      className={className}
      src={picked.src}
      alt={alt}
      draggable={false}
    />
  )
}
