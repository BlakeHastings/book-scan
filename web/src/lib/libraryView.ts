/**
 * Kept in localStorage rather than in App state: the library is unmounted the moment a book is
 * opened from it, and a preference that resets every time you come back from a book is not a
 * preference. It also has to survive a reload, since the phone this runs on drops the page
 * whenever the camera app is used.
 */

export type LibraryView = 'shelf' | 'list' | 'gallery'

/** In the order they are offered. Spines first: what somebody who has never chosen gets. */
export const LIBRARY_VIEWS: readonly LibraryView[] = ['shelf', 'list', 'gallery']

/** A word each, because the switcher is a thumb-sized pill. */
export const VIEW_LABEL: Record<LibraryView, string> = {
  shelf: 'Shelf',
  list: 'List',
  gallery: 'Covers',
}

/** Read out to somebody who cannot see which one is lit. */
export const VIEW_DESCRIPTION: Record<LibraryView, string> = {
  shelf: 'Shelf: one run of spines per area',
  list: 'List: one book per line',
  gallery: 'Covers: a grid of covers per area',
}

export const DEFAULT_VIEW: LibraryView = 'shelf'

const KEY = 'bookscan.libraryView'

/**
 * Turn whatever was stored into a view.
 *
 * Anything unrecognised falls back rather than throwing: the value outlives
 * the code that wrote it, so a build that drops a view would otherwise leave
 * somebody with a library that renders nothing.
 */
export function parseView(stored: string | null | undefined): LibraryView {
  return LIBRARY_VIEWS.includes(stored as LibraryView)
    ? (stored as LibraryView)
    : DEFAULT_VIEW
}

/** The view to open on. `DEFAULT_VIEW` for somebody who has never chosen. */
export function rememberedView(): LibraryView {
  try {
    return parseView(localStorage.getItem(KEY))
  } catch {
    // Private browsing can refuse storage outright, but that must not stop the library from working.
    return DEFAULT_VIEW
  }
}

export function rememberView(view: LibraryView): void {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    // As above: worth doing, never worth failing over.
  }
}
