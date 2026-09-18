/**
 * What a catalogued book looks like to the design system.
 *
 * Every drawing takes both the cloth (for when there is no photograph) and
 * the photograph over it, since the app has photographs unevenly across the
 * collection.
 *
 * The precedence is decided in `lib/shelfRow.ts`, in one place each for the
 * spine and the cover, so the three views cannot disagree about a book.
 */

import { coverOf, spineLabel, spineOf } from './shelfRow'
import { coverThumbUrl } from '../components/PlacementCard'
import type { Cloth, ShelfItem } from '../design/Shelf'
import type { FiledBookRow, PlacementStrip, StripBook } from './api'

/**
 * The binding a book with no photograph is drawn in, picked off the book's
 * own id so the same book is always the same colour.
 */
const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']

export function clothFor(id: number): Cloth {
  return CLOTHS[Math.abs(id) % CLOTHS.length]!
}

/**
 * The picture for a book lying face up, at a width the server will resize
 * to. The server only answers three widths; anything else is silently the
 * original, full-size file.
 */
export function coverArt(book: FiledBookRow, width: 160 | 320 | 640 = 320): string {
  return coverThumbUrl(coverOf(book).cover, width)
}

/** The picture for a book standing up, which is a spine two centimetres wide. */
export function spineArt(book: FiledBookRow, width: 160 | 320 | 640 = 160): string {
  return coverThumbUrl(spineOf(book).spine, width)
}

/**
 * How thick a book is, as a number, or nothing. `books.pages` is free text
 * from the catalogue ("320", "320 pages", or nothing), so this is where
 * that becomes a plain count, or `undefined` when the catalogue gave
 * nothing usable. `spineWidth` draws an `undefined` book at the median
 * width of the ones that do have a count.
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

/**
 * The run a book stands in, with that book marked.
 *
 * The mark is `here`, a cat drawn on top of the book rather than a ring
 * around it: a ring is drawn outside the element and the run scrolls inside
 * itself, so the top of a ring was cut off.
 *
 * A book that is not in the run gets a hole where it goes: `placedIndex` is
 * null when the order wants it somewhere it is not.
 */
export function standing(
  strip: PlacementStrip,
  id: number,
  onOpen?: (id: number) => void,
): ShelfItem[] {
  return run(strip, (book) => book.id === id, onOpen)
}

/**
 * The run a book is being put into, with the hole it is going in. The same
 * drawing as `standing`, but marks by index rather than id: until somebody
 * writes it down, the book being placed has no id in this row yet.
 */
export function placing(
  strip: PlacementStrip,
  onOpen?: (id: number) => void,
): ShelfItem[] {
  return run(strip, (_book, index) => strip.placedIndex === index, onOpen)
}

/**
 * A run of spines with one of them marked, and a hole where the marked one
 * is not standing yet. The marked book has no `onOpen`, since it is already
 * the book on screen.
 */
function run(
  strip: PlacementStrip,
  here: (book: StripBook, index: number) => boolean,
  onOpen?: (id: number) => void,
): ShelfItem[] {
  const row: ShelfItem[] = strip.books.map((book, index) => asSpine(book, {
    here: here(book, index),
    onOpen: here(book, index) ? undefined : onOpen,
  }))

  if (strip.placedIndex !== null) return row

  const at = Math.max(0, Math.min(strip.gapIndex, row.length))
  return [...row.slice(0, at), { kind: 'gap' }, ...row.slice(at)]
}

/**
 * One catalogued book, standing up. Takes a `StripBook`, the shape every
 * read that answers books to stand on a board uses (the placing strip, the
 * carry list, and the books in an area), so no board draws the same book
 * differently.
 */
function asSpine(
  book: StripBook,
  { here, onOpen }: { here?: boolean; onOpen?: (id: number) => void } = {},
): ShelfItem {
  return {
    kind: 'spine',
    // Written down the spine when there is no photograph: the filing name.
    text: book.authorFiling || book.title || spineLabel(book),
    // For anyone not looking at pixels, which is not the same string as `text`.
    name: spineLabel(book),
    cloth: clothFor(book.id),
    pages: pagesOf(book),
    photo: coverThumbUrl(book.spine, 160),
    here,
    onPress: onOpen ? () => onOpen(book.id) : undefined,
  }
}

/**
 * A place's books, standing on its board, in the order they stand.
 *
 * The caller has already put them in order: a board is a picture of a row,
 * and the order a row reads in is the place's own ordering, which this does
 * not hold.
 */
export function board(
  books: readonly StripBook[],
  onOpen?: (id: number) => void,
): ShelfItem[] {
  return books.map((book) => asSpine(book, { onOpen }))
}
