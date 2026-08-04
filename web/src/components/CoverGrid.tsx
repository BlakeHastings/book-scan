import { coverLabel, coverOf, type GridBook } from '../lib/shelfRow'
import { coverThumbUrl } from './PlacementCard'
import type { BookRow } from '../lib/api'

/**
 * One area as a grid of covers, in shelf order.
 *
 * This one wraps, and the spine row still refuses to (#82). They are not the
 * same picture. A run of spines is a drawing of the furniture, where a break
 * in the run means "a new area" and a wrapped row would put a bookcase in the
 * room that is not there. A grid of covers is not pretending to be a
 * photograph of a shelf: it is the books laid out face up in the order they
 * stand, so a line break costs nothing and reading left to right, top to
 * bottom is how everyone already reads a page.
 *
 * The order and the grouping are the point. Sorted by title it would be a
 * different set of books; grouped by area it stays legible once it wraps,
 * because the heading above each grid says which stretch of shelf you are
 * looking at.
 *
 * The number in the corner is the same number the spine row draws: what you
 * count along the shelf to find the book. That is why the run here is the run
 * on the bookcase and not one book more. A book somebody has taken away is in
 * the list above the grids, where something you cannot see belongs.
 */
export function CoverGrid({
  books, label, onOpen,
}: {
  /** In shelf order, exactly as the area was laid out. */
  books: BookRow[]
  /** The area's label, named for a screen reader since the heading is outside. */
  label: string
  onOpen: (id: number) => void
}) {
  return (
    <ol
      className="covers"
      aria-label={`Area ${label}, ${books.length} books`}
    >
      {books.map((row, i) => (
        <Tile key={row.id} book={coverOf(row)} position={i + 1} onOpen={onOpen} />
      ))}
    </ol>
  )
}

function Tile({
  book, position, onOpen,
}: {
  book: GridBook
  position: number
  onOpen: (id: number) => void
}) {
  const described = coverLabel(book)

  const className = [
    'cover',
    // Not a front cover of this copy. Marked the way a spine row marks a
    // cover standing in for a spine, and for the same reason: the picture is
    // the only thing on the tile, so what it is has to be readable off it.
    book.cover && book.coverSlot !== 'front' ? 'cover--stand-in' : '',
  ].filter(Boolean).join(' ')

  return (
    <li className="covers__cell">
      <button
        type="button"
        className={className}
        title={`${position}. ${described}`}
        aria-label={`${position}. ${described}`}
        onClick={() => onOpen(book.id)}
      >
        {book.cover ? (
          <img
            className={`cover__photo cover__photo--${book.coverSlot}`}
            /*
             * A tile is around 120 CSS pixels wide. 320 is over twice that,
             * which covers a dense screen, and a fraction of the full size
             * file the detail view gets.
             *
             * `loading="lazy"` with the tile's aspect ratio fixed in CSS is
             * the other half: the browser knows how tall every tile is before
             * its picture arrives, so it only fetches the ones near the
             * screen and nothing jumps as they land.
             */
            src={coverThumbUrl(book.cover, 320)}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          /* No photograph and no catalogue cover either. The filing name and
             the title, the same two things a blank spine carries, rather than
             a grey rectangle that says the app is broken. */
          <span className="cover__blank">
            <span className="cover__blank-author">{book.authorFiling}</span>
            <span className="cover__blank-title">{book.title}</span>
          </span>
        )}

        <span className="cover__no">{position}</span>

        {/* Said on the tile, not just in its label. A stock cover next to
            twenty photographs is the one somebody will take for a photograph
            of their own book. */}
        {book.fromCatalogue && (
          <span className="cover__note">Publisher&rsquo;s picture</span>
        )}
      </button>
    </li>
  )
}
