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

import { coverOf, spineLabel, spineOf } from './shelfRow'
import { coverThumbUrl } from '../components/PlacementCard'
import type { Cloth, ShelfItem } from '../design/Shelf'
import type { FiledBookRow, PlacementStrip, StripBook } from './api'

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

/**
 * The run a book stands in, with that book marked.
 *
 * One definition and two callers: the book's own page, and the screen its
 * pencil opens. The mark is `here`, which puts the cat on top of the book
 * rather than a ring around it: a ring is drawn outside the element, the run
 * scrolls inside itself, and the top of it was cut off every time. Tapping any
 * other spine walks along the shelf, which is what a row of books is for; the
 * book the screen is about goes nowhere, because it is already here.
 *
 * **A book that is not in the run gets a hole where it goes**, which is the
 * other half of what a placement says. `placedIndex` is null for a book the
 * order wants somewhere it is not, and drawing that run with nothing in it
 * would be a row of other people's books under a card saying this one belongs
 * in it. The gap is `Shelf`'s own, so it is the same hole the shelving step
 * opens.
 */
export function standing(
  strip: PlacementStrip,
  id: number,
  onOpen?: (id: number) => void,
): ShelfItem[] {
  return run(strip, (book) => book.id === id, onOpen)
}

/**
 * The run a book is being put into, with the hole it is going in.
 *
 * The other end of the same drawing, and deliberately the same function. The
 * book's own page marks the book it is about; the placing step marks the space
 * a book in somebody's hand is about to stand in. One says which book by its
 * id, because that is what it holds; the other says which by where it sits in
 * the row, because until somebody writes it down the book has no id in that row
 * at all. Everything after that is identical, and a second copy of it is how
 * one drawing of a shelf becomes two.
 */
export function placing(
  strip: PlacementStrip,
  onOpen?: (id: number) => void,
): ShelfItem[] {
  return run(strip, (_book, index) => strip.placedIndex === index, onOpen)
}

/**
 * A run of spines with one of them marked, and a hole where the marked one is
 * not standing yet.
 *
 * The marked book is never a way back to itself: it is already the book on
 * screen, so it is drawn rather than offered. Every other spine is a step along
 * the shelf, wherever the caller has somewhere for it to go.
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
 * One catalogued book, standing up.
 *
 * The one place a book becomes a spine, and it takes a `StripBook` because
 * every read that answers books to stand on a board answers that shape: the
 * placing strip, the carry list, and since #405 the books in an area. A second
 * spelling of these six fields is how one board ends up drawing a book that
 * another board draws differently.
 */
function asSpine(
  book: StripBook,
  { here, onOpen }: { here?: boolean; onOpen?: (id: number) => void } = {},
): ShelfItem {
  return {
    kind: 'spine',
    // What is written down a spine with no photograph, which is the filing
    // name: that is what you read walking along a shelf.
    text: book.authorFiling || book.title || spineLabel(book),
    // And what it is called for anybody not looking at pixels, which is not
    // the same string. A run announced as its filing names says which shelf
    // you are on and never which book.
    name: spineLabel(book),
    cloth: clothFor(book.id),
    pages: pagesOf(book),
    photo: coverThumbUrl(book.spine, 160),
    here,
    onPress: onOpen ? () => onOpen(book.id) : undefined,
  }
}

/**
 * A place's books, standing on its board, in the order they stand (#405).
 *
 * > At the bottom where we say "standing on Bookshelf X" and we show all the
 * > books that are in the area: let's switch that to a shelf view instead of a
 * > list.
 *
 * They were rows of text on the one page in the app that is about a physical
 * row of books. The board is what the app draws everywhere else, so this is the
 * same mapping the library and the carry list already go through rather than a
 * second one: the photograph over the cloth, the width off the page count, the
 * filing name printed down it and the title said out loud.
 *
 * **The caller has already put them in order.** A board is a picture of a row,
 * and the order a row reads in is the place's own ordering, which is a fact the
 * caller holds and this does not.
 */
export function board(
  books: readonly StripBook[],
  onOpen?: (id: number) => void,
): ShelfItem[] {
  return books.map((book) => asSpine(book, { onOpen }))
}
