import { useEffect, useRef } from 'react'
import type { PlacementResponse, PlacementStrip } from '../lib/api'
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
  placement, pending,
}: {
  placement: PlacementResponse | null
  pending: boolean
}) {
  if (!placement?.strip) {
    return <PlacementCard placement={placement} pending={pending} saved={false} />
  }

  return (
    <div className={pending ? 'placement--stale' : ''}>
      <p className="placement-view__instruction">{placement.instruction}</p>
      <ShelfStrip strip={placement.strip} authorFiling={placement.authorFiling} />
    </div>
  )
}

interface Props {
  strip: PlacementStrip
  /** Filing name of the book being placed, written down its spine. */
  authorFiling: string
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
 * Only the two books touching the gap show their spine photo, because they
 * are the only ones you have to recognise. The rest are plain blocks: they
 * are there to be counted along, not read.
 */
export function ShelfStrip({ strip, authorFiling }: Props) {
  const focusRef = useRef<HTMLDivElement>(null)

  // A full shelf is wider than a phone, and only one part of it is worth
  // looking at, so bring that into view rather than starting at book one.
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [strip.label, strip.gapIndex, strip.placedIndex, strip.books.length])

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

      <div className="strip__scroll">
        {/* One grid so the shelf line and the book below stay aligned with
            the gap no matter how far the row is scrolled. */}
        <div className="strip__grid">
          {strip.books.map((book, i) => (
            <Spine
              key={book.id}
              book={book}
              position={i + 1}
              // Without a gap the columns are simply the books; with one,
              // everything past it shifts along to leave the space.
              column={placed || i < strip.gapIndex ? i + 1 : i + 2}
              here={placed && i === strip.placedIndex}
              markRef={placed && i === strip.placedIndex ? focusRef : undefined}
            />
          ))}

          {!placed && (
            <>
              <div
                ref={focusRef}
                className="strip__gap"
                style={{ gridColumn: strip.gapIndex + 1 }}
                aria-label="where this book goes"
              />
              <div className="strip__new" style={{ gridColumn: strip.gapIndex + 1 }}>
                <span className="strip__new-author">{authorFiling || 'this book'}</span>
              </div>
            </>
          )}

          <div className="strip__shelf" />
        </div>
      </div>
    </div>
  )
}

function Spine({
  book, position, column, here = false, markRef,
}: {
  book: PlacementStrip['books'][number]
  position: number
  column: number
  /** This is the book being looked at, already in place. */
  here?: boolean
  markRef?: React.RefObject<HTMLDivElement>
}) {
  const photo = coverUrl(book.spine)

  return (
    <div
      ref={markRef}
      className={[
        'spine',
        photo ? 'spine--known' : '',
        here ? 'spine--here' : '',
      ].filter(Boolean).join(' ')}
      style={{ gridColumn: column }}
      title={`${position}. ${book.title}`}
    >
      {photo ? (
        <img
          className={`spine__photo spine__photo--${book.spineSlot}`}
          src={photo}
          alt={book.title}
          loading="lazy"
        />
      ) : (
        <span className="spine__author">{book.authorFiling}</span>
      )}
      <span className="spine__no">{position}</span>
    </div>
  )
}
