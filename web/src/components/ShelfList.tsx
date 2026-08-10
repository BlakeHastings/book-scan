import type { CheckedOutAt, FiledBookRow, ShelfGroupDto } from '../lib/api'
import { listOf, spineOf } from '../lib/shelfRow'
import { coverUrl } from './PlacementCard'

/**
 * One area as a vertical list, a line per book.
 *
 * This is the library as it was before the spine rows landed, restored rather
 * than rewritten (#82): the owner wanted it back, and it worked. What a line
 * carries and how it is laid out are unchanged. Two things had moved
 * underneath it in the meantime and are picked up rather than reinstated: the
 * thumbnail's fallback order now comes from `shelfImage` through `spineOf`, so
 * this cannot disagree with the spine row about which photo a book shows, and
 * opening a book goes through the caller's handler, which is what remembers
 * where the library was.
 *
 * It is the only one of the three that draws a book that is not there. A spine
 * row and a grid of covers are pictures of a bookcase, and a book somebody has
 * taken away is not in the picture; a line of text can say so and keep the
 * alphabetical gap visible, which is what it has always done.
 */
export function ShelfList({
  group, checkedOut, onOpen,
}: {
  group: ShelfGroupDto
  /** Every book off the bookcase; the ones belonging here are filed in. */
  checkedOut: CheckedOutAt[]
  onOpen: (id: number) => void
}) {
  /** What you read walking along a shelf, which is the author, not the title. */
  const filing = (book: FiledBookRow) => book.author_filing || book.authors || book.title

  return (
    <ol className="shelf">
      {listOf(group, checkedOut).map(({ book, n, here }) => {
        const photo = spineOf(book)

        return (
          <li key={book.id} className={here ? 'shelfrow' : 'shelfrow shelfrow--off'}>
            {/* Count along the shelf to find it. The old per-row A1 is gone
                now that the header carries the location, so this is what
                identifies a book in the room. */}
            <span className="shelfrow__n">{here ? n : '--'}</span>
            <span className="shelfrow__photo">
              {photo.spine && (
                <img
                  className={`thumb thumb--${photo.spineSlot}`}
                  src={coverUrl(photo.spine)}
                  alt=""
                  loading="lazy"
                />
              )}
            </span>
            <button className="shelfrow__body" onClick={() => onOpen(book.id)}>
              <span className="shelfrow__author">{filing(book)}</span>
              <span className="shelfrow__title">{book.title}</span>
            </button>
            {/* Repeated per row so a row still says where it is once the
                header has scrolled away. */}
            <span className="shelfrow__loc">
              {here ? group.label : 'off bookcase'}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
