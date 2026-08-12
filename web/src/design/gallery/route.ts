/**
 * Where the wireframe lives, and how the app decides it is being asked for.
 *
 * The app has no router and is not getting one for this. A hash is the whole
 * mechanism: the server never sees it, so no route has to be added to Express
 * or to Vite, a reload lands back on the same screen, and the phone's back
 * button walks the gallery because the browser already keeps a history of
 * hashes. That is the smallest thing that works, and it is deliberately not a
 * library.
 *
 *     #/design            the index
 *     #/design/where      one screen
 *
 * Anything else is not the gallery, which is the case that matters: this
 * function is the only thing standing between an ordinary visit to the app
 * and a wireframe rendered over the top of it.
 */

export const GALLERY_HASH = '#/design'

export interface GalleryRoute {
  /** Null on the index, otherwise the screen being asked for. */
  screen: string | null
}

/**
 * The gallery route in a hash, or null when the hash is not the gallery's.
 *
 * Returns null rather than an index route for a hash the app itself might one
 * day use, so adding `#queue` to the working app cannot accidentally open the
 * wireframe.
 */
export function galleryRoute(hash: string): GalleryRoute | null {
  const path = hash.startsWith('#') ? hash.slice(1) : hash
  if (path !== '/design' && !path.startsWith('/design/')) return null

  const rest = path.slice('/design'.length).replace(/^\/+|\/+$/g, '')
  return { screen: rest === '' ? null : rest }
}

/** The hash that opens a screen, or the index when given nothing. */
export function hashFor(screen?: string): string {
  return screen ? `${GALLERY_HASH}/${screen}` : GALLERY_HASH
}
