import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlacementResponse, PlacementStrip, StripBook } from '../lib/api'
import { spineLabel } from '../lib/shelfRow'
import { coverUrl, PlacementCard } from './PlacementCard'

/**
 * How a placement is shown, wherever it is shown.
 *
 * Both the detail view and the shelving step answer the same question, so
 * they answer it the same way. Falls back to the old card when a placement
 * arrives without a strip, which is what an empty range or an older server
 * would give.
 */
export function PlacementView({
  placement, pending, instruction = true, onOpen,
}: {
  placement: PlacementResponse | null
  pending: boolean
  /**
   * Whether to spell the placement out in words as well as drawing it. The
   * shelving step wants both; the detail view does not, because there the
   * drawing is context rather than an instruction to act on.
   */
  instruction?: boolean
  /**
   * Jump to another book in the row. The detail view passes this, so the
   * neighbours you are looking at are the way to reach them (#81). The
   * shelving step does not: there you are holding a book, and walking off to
   * a different record mid-placement loses it.
   */
  onOpen?: (id: number) => void
}) {
  if (!placement?.strip) {
    return <PlacementCard placement={placement} pending={pending} saved={false} />
  }

  return (
    <div className={pending ? 'placement--stale' : ''}>
      {instruction && (
        <p className="placement-view__instruction">{placement.instruction}</p>
      )}
      <ShelfStrip
        strip={placement.strip}
        authorFiling={placement.authorFiling}
        onOpen={onOpen}
      />
    </div>
  )
}

interface Props {
  strip: PlacementStrip
  /** Filing name of the book being placed, written down its spine. */
  authorFiling: string
  onOpen?: (id: number) => void
}

/**
 * The shelf drawn end on, the way it looks when you are standing at it.
 *
 * A predecessor and a successor tell you what to look for but not what you
 * are looking at. Five books to the left and two to the right is a different
 * search from two and five, and a pair of names cannot say which. Here the
 * row is drawn whole, the gap is in its actual place, and the book in your
 * hand hangs below it.
 *
 * The counts in the header are the reason this wrapper exists at all: they
 * belong to a placement, which has a gap to count either side of.
 *
 * **This is the placing strip and nothing else now** (#387). The shelves screen
 * called `SpineRow` directly for its library rows, so this file drew two
 * different things and disagreed with `design/Shelf.tsx` about how wide a book
 * is, what marks the one a screen is about, and whether a spine is numbered.
 * That screen is drawn with the design system now and this is left with the one
 * job its name is for: a run with a hole in it, and the book in your hand
 * hanging below the hole. `SpineRow` is private again in consequence.
 */
export function ShelfStrip({ strip, authorFiling, onOpen }: Props) {
  // Already on the shelf: it is drawn in the row, and there is no gap to open
  // and nothing to carry over. Otherwise the row breaks at the gap.
  const placed = strip.placedIndex !== null
  const at = placed ? strip.placedIndex! : strip.gapIndex
  const left = at
  const right = strip.books.length - at - (placed ? 1 : 0)

  return (
    <div className="strip">
      <div className="strip__head">
        <span className="strip__label">{strip.label}</span>
        <span className="strip__counts">
          {left} to the left · {right} to the right
        </span>
      </div>

      <SpineRow
        // A different shelf is a different row, and the effect that brings
        // the interesting part of it into view has to run again for it.
        key={strip.label}
        books={strip.books}
        gap={placed ? null : { index: strip.gapIndex, authorFiling }}
        hereIndex={strip.placedIndex}
        label={strip.label}
        onOpen={onOpen}
      />
    </div>
  )
}

interface RowProps {
  books: StripBook[]
  /**
   * Where a book is being inserted, and what is written down its spine while
   * it hangs below the plank waiting to go in. Null for a row that is just a
   * row.
   */
  gap?: { index: number; authorFiling: string } | null
  /** The book this row is about, drawn in place rather than as a hole. */
  hereIndex?: number | null
  /** Named for a screen reader, since the shelf label sits outside it. */
  label: string
  /** Tap a spine to open that book. */
  onOpen?: (id: number) => void
}

/**
 * One run of books, drawn end on and scrolled sideways.
 *
 * Deliberately does not wrap. An area is one continuous run of spines left to
 * right, and a break in it means "new area" everywhere else in this app, so a
 * wrapped row would draw furniture that is not there (#81). The overflow is
 * native, with snap points, rather than a pointer-drag handler: the browser
 * decides from the first few pixels of a gesture which axis it belongs to and
 * gives the other one to the page, which is what stops a long row fighting
 * the page scroll. A hand-rolled drag has to guess, and guesses wrong on a
 * thumb moving diagonally. Same reasoning as the photo carousel in #50.
 */
function SpineRow({
  books, gap = null, hereIndex = null, label, onOpen,
}: RowProps) {
  const focusRef = useRef<HTMLElement | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  /**
   * Whether the run actually continues past each edge.
   *
   * The edges are faded to say "there is more of this shelf that way", and a
   * fade on an edge with nothing beyond it says something false. The placing
   * strip never noticed, because it opens scrolled to the gap and so is
   * almost always mid-row; a library row starts at its first book, where a
   * faded left edge dims book one for no reason.
   */
  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setMore({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    })
  }, [])

  // A full shelf is wider than a phone. When one part of it is the point,
  // bring that into view rather than starting at book one. A library row has
  // neither a gap nor a book of its own, so nothing is scrolled and whatever
  // position the caller restored survives.
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
    measure()
  }, [gap?.index, hereIndex, books.length, measure])

  // Rotating the phone changes how much of a row fits, and so changes which
  // edges have anything beyond them.
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return (
    <div
      ref={scroller}
      className={[
        'strip__scroll',
        more.left ? 'strip__scroll--more-left' : '',
        more.right ? 'strip__scroll--more-right' : '',
      ].filter(Boolean).join(' ')}
      onScroll={measure}
      role="group"
      aria-label={`Area ${label}, ${books.length} books`}
    >
      {/* One grid so the shelf line and the book below stay aligned with
          the gap no matter how far the row is scrolled. */}
      <div className="strip__grid">
        {books.map((book, i) => (
          <Spine
            key={book.id}
            book={book}
            position={i + 1}
            // Without a gap the columns are simply the books; with one,
            // everything past it shifts along to leave the space.
            column={!gap || i < gap.index ? i + 1 : i + 2}
            here={hereIndex === i}
            onOpen={onOpen}
            register={(element) => {
              if (hereIndex === i) focusRef.current = element
            }}
          />
        ))}

        {gap && (
          <>
            <div
              ref={(element) => { focusRef.current = element }}
              className="strip__gap"
              style={{ gridColumn: gap.index + 1 }}
              aria-label="where this book goes"
            />
            <div className="strip__new" style={{ gridColumn: gap.index + 1 }}>
              <span className="strip__new-author">{gap.authorFiling || 'this book'}</span>
            </div>
          </>
        )}

        <div className="strip__shelf" />
      </div>
    </div>
  )
}

function Spine({
  book, position, column, here = false, onOpen, register,
}: {
  book: StripBook
  position: number
  column: number
  /** This is the book being looked at, already in place. */
  here?: boolean
  onOpen?: (id: number) => void
  register?: (element: HTMLElement | null) => void
}) {
  const photo = coverUrl(book.spine)
  const described = spineLabel(book)

  const className = [
    'spine',
    photo ? 'spine--known' : '',
    // Said out loud rather than passed off as a spine: this book was
    // catalogued before the spine slot existed and is showing a cover.
    photo && book.spineSlot !== 'edge' ? 'spine--cover' : '',
    here ? 'spine--here' : '',
    onOpen ? 'spine--tap' : '',
  ].filter(Boolean).join(' ')

  const inside = (
    <>
      {photo ? (
        <img
          className={`spine__photo spine__photo--${book.spineSlot}`}
          src={photo}
          alt={described}
          loading="lazy"
        />
      ) : (
        <span className="spine__author">{book.authorFiling}</span>
      )}
      <span className="spine__no">{position}</span>
    </>
  )

  // A button only where tapping it does something. A spine in the shelving
  // step is a drawing of a shelf, and a drawing is not a menu.
  if (!onOpen) {
    return (
      <div
        ref={register}
        className={className}
        style={{ gridColumn: column }}
        title={`${position}. ${described}`}
      >
        {inside}
      </div>
    )
  }

  return (
    <button
      ref={register}
      type="button"
      className={className}
      style={{ gridColumn: column }}
      title={`${position}. ${described}`}
      onClick={() => onOpen(book.id)}
    >
      {inside}
    </button>
  )
}
