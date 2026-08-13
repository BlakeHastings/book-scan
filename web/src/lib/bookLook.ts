/**
 * What a catalogued book looks like to the design system.
 *
 * The wireframe draws books as dyed cloth because it has no photographs. The
 * app has them, and it has them unevenly: a spine here, a downloaded cover
 * there, and nothing at all for a good part of the collection. So every drawing
 * takes both, the cloth underneath and the photograph over it, and this is where
 * a row of the catalogue becomes that pair.
 *
 * The precedence is not decided here. `lib/shelfRow.ts` already answers "which
 * photograph stands in for this book's spine" and "which one stands in for its
 * cover", in one place each, so the three views cannot disagree about a book.
 * All this adds is the size to ask the server for and the cloth to put behind it.
 */

import { coverOf, spineOf } from './shelfRow'
import { coverThumbUrl } from '../components/PlacementCard'
import type { Cloth } from '../design/Shelf'
import type { FiledBookRow } from './api'

/**
 * The binding a book with no photograph is drawn in.
 *
 * Picked off the book's own id, so a book is the same colour every time it is
 * drawn rather than a different one on every render, and so the same book is
 * the same colour in the covers, in the list and standing on the board.
 */
const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']

export function clothFor(id: number): Cloth {
  return CLOTHS[Math.abs(id) % CLOTHS.length]!
}

/**
 * The picture for a book lying face up, at a width the server will resize to.
 *
 * 320 for a tile about 120 CSS pixels wide, which covers a dense screen at a
 * fraction of the full size file. The server answers three widths and nothing
 * else, and anything not on the list is silently the original, which on a screen
 * of a hundred books is somebody's data allowance.
 */
export function coverArt(book: FiledBookRow, width: 160 | 320 | 640 = 320): string {
  return coverThumbUrl(coverOf(book).cover, width)
}

/** The picture for a book standing up, which is a spine two centimetres wide. */
export function spineArt(book: FiledBookRow, width: 160 | 320 | 640 = 160): string {
  return coverThumbUrl(spineOf(book).spine, width)
}

/**
 * How thick a book is, as a number, or nothing.
 *
 * `books.pages` is text, because it is whatever a catalogue said: "320", "320
 * pages", or nothing at all for about one book in four. This is where that
 * becomes the one measurement a spine's width may come from, and where a book
 * the catalogue cannot answer for becomes `undefined` rather than a zero.
 *
 * **`undefined` is the honest answer and it has a drawing of its own.**
 * `spineWidth` puts such a book at the median of the ones that do have a count,
 * which is the owner's decision and is pinned by a test: a quarter of a shelf
 * shouting that a field is empty would be a chart rather than a picture of a
 * room.
 */
export function pagesOf(book: { pages?: string | null }): number | undefined {
  const digits = /\d+/.exec(String(book.pages ?? ''))
  if (!digits) return undefined

  const count = Number.parseInt(digits[0], 10)
  return Number.isFinite(count) && count > 0 ? count : undefined
}

/** What this collection files a book under, falling back to what is printed. */
export function filedAs(book: FiledBookRow): string {
  return book.author_filing || book.authors || ''
}
