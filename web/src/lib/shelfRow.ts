import type { CheckedOutAt, FiledBookRow, ShelfGroupDto, StripBook } from './api'
import { bookCover, shelfImage, type CoverSlot, type ShelfSlot } from '../../shared/shelving'

/**
 * Turning what the catalogue stores into what a shelf looks like.
 *
 * The server hands the placing strip out ready drawn, because it computes the
 * layout anyway. The library gets whole groups of raw rows instead, so the
 * same book has to be turned into the same spine on this side. Both go
 * through `shelfImage`, which is the only place the fallback order is
 * written, so a book cannot show its front cover in one view and its spine in
 * the other.
 */

/** One catalogued book as it is drawn standing on a shelf. */
export function spineOf(book: FiledBookRow): StripBook {
  const photo = shelfImage({
    front: book.front_image ?? '',
    back: book.back_image ?? '',
    edge: book.edge_image ?? '',
    // A spine is drawn two centimetres wide, so the margin around it left by
    // the capture guide is a real part of the picture. Cropping it is the
    // same decision the gallery makes, in the one place the precedence is
    // written down.
    crops: {
      front: book.front_crop ?? '',
      back: book.back_crop ?? '',
      edge: book.edge_crop ?? '',
    },
  })

  return {
    id: book.id,
    title: book.title,
    // What is written down the spine when there is no photograph: the
    // author, since that is what you read walking along a shelf.
    authorFiling: book.author_filing || book.authors || book.title,
    spine: photo.name,
    spineSlot: photo.slot,
  }
}

/** One line of the vertical list: a book, its position, and whether it is there. */
export interface ListRow {
  book: FiledBookRow
  /** What you count along to. Zero for a book that is not on the bookcase. */
  n: number
  here: boolean
}

/**
 * The books on a shelf plus, in their alphabetical slots, the ones that
 * belong there but are currently off it.
 *
 * The numbering counts only what is physically present, since that is
 * what you use to find a book by counting along; an absent book gets a
 * dash rather than a number.
 *
 * This is the one thing the list does that the spine row and the gallery
 * do not: those two draw the run as it physically stands, since a spine
 * or a cover is a picture of furniture and a book that is out of the
 * house is not in the picture.
 */
export function listOf(group: ShelfGroupDto, checkedOut: CheckedOutAt[]): ListRow[] {
  const present: ListRow[] = group.books.map(({ book }, i) => ({ book, n: i + 1, here: true }))
  const absent: ListRow[] = checkedOut
    .filter((entry) => onThisBoard(group, entry))
    .map((entry) => ({ book: entry.book, n: 0, here: false }))

  return [...present, ...absent].sort((a, b) =>
    a.book.sort_key < b.book.sort_key ? -1 : a.book.sort_key > b.book.sort_key ? 1 : 0)
}

/**
 * Whether a book that is off the shelf belongs on this board. Matched by
 * area id where both sides have one; only falls back to the label when
 * neither does, since a label is a rendering and can differ once a
 * bookcase is named.
 */
const onThisBoard = (group: ShelfGroupDto, entry: CheckedOutAt): boolean =>
  (group.areaId !== null && entry.areaId !== null
    ? group.areaId === entry.areaId
    : group.areaId === null && entry.areaId === null && group.label === entry.label)

/** How many books belonging in this area are off the bookcase right now. */
export function missingFrom(group: ShelfGroupDto, checkedOut: CheckedOutAt[]): number {
  return checkedOut.filter((entry) => onThisBoard(group, entry)).length
}

/** One catalogued book as a tile in the gallery. */
export interface GridBook {
  id: number
  title: string
  /** Written across a tile that has no picture, the way a blank spine is. */
  authorFiling: string
  cover: string
  coverSlot: CoverSlot
  /** The publisher's picture rather than a photograph of this copy. */
  fromCatalogue: boolean
  /** Cut to the book, so the room it was photographed in is not in the tile. */
  cropped: boolean
}

/**
 * One book as it is drawn lying face up in the gallery. The sibling of
 * `spineOf`, going through the same shared rule for the same reasons.
 */
export function coverOf(book: FiledBookRow): GridBook {
  const picture = bookCover({
    front: book.front_image ?? '',
    back: book.back_image ?? '',
    edge: book.edge_image ?? '',
    catalogue: book.cover_image ?? '',
    // The gallery is the reason cropping exists: a wall of photographs with
    // somebody's feet in the corner of half of them.
    crops: {
      front: book.front_crop ?? '',
      back: book.back_crop ?? '',
      edge: book.edge_crop ?? '',
    },
  })

  return {
    id: book.id,
    title: book.title,
    authorFiling: book.author_filing || book.authors || book.title,
    cover: picture.name,
    coverSlot: picture.slot,
    fromCatalogue: picture.fromCatalogue,
    cropped: picture.cropped,
  }
}

/**
 * What a tile is showing, where that is not what it looks like.
 *
 * Every case except a front cover is one somebody would otherwise get
 * wrong: a spine or a back standing in reads as a badly cropped cover, and
 * the publisher's picture reads as a photograph of this copy rather than a
 * stock image.
 *
 * Said in words under the tile (`CoverItem.meta`) rather than drawn on it.
 * A tile whose picture is a front cover, or whose book has no photograph
 * at all, says nothing.
 */
export function coverNote(book: GridBook): string {
  if (book.coverSlot === 'edge') return 'Spine, no cover photo'
  if (book.coverSlot === 'back') return 'Back cover, no front cover photo'
  if (book.coverSlot === 'catalogue') return "The publisher's picture, not this copy"
  return ''
}

/** What a spine is showing, for the people who cannot see it. */
export function spineLabel(book: StripBook, slot: ShelfSlot = book.spineSlot): string {
  if (slot === 'edge') return `${book.title}, spine`
  if (slot === 'front') return `${book.title}, front cover, no spine photo`
  if (slot === 'back') return `${book.title}, back cover, no spine photo`
  return `${book.title}, no photo`
}
