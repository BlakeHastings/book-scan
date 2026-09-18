/**
 * The gallery lives at `#/design`, matched as a prefix so `#/design/where`
 * opens one screen:
 *
 *     #/design            the index
 *     #/design/where      one screen
 *
 * Anything else falls through to the app.
 */

export const GALLERY_HASH = '#/design'

export interface GalleryRoute {
  /** Null on the index, otherwise the screen being asked for. */
  screen: string | null
}

/**
 * The gallery route in a hash, or null when the hash is not the gallery's, so
 * the app can use other hashes like `#queue` without the wireframe opening.
 */
export function galleryRoute(hash: string): GalleryRoute | null {
  const path = hash.startsWith('#') ? hash.slice(1) : hash
  if (path !== '/design' && !path.startsWith('/design/')) return null

  const rest = path.slice('/design'.length).replace(/^\/+|\/+$/g, '')
  return { screen: rest === '' ? null : rest }
}

export function hashFor(screen?: string): string {
  return screen ? `${GALLERY_HASH}/${screen}` : GALLERY_HASH
}
