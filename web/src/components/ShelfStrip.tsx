import { useEffect, useRef } from 'react'
import type { PlacementStrip } from '../lib/api'
import { coverUrl } from './PlacementCard'

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
  const gapRef = useRef<HTMLDivElement>(null)

  // A full shelf is wider than a phone, and the gap is the only part worth
  // looking at, so bring it into view rather than starting at book one.
  useEffect(() => {
    gapRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [strip.label, strip.gapIndex, strip.books.length])

  const left = strip.gapIndex
  const right = strip.books.length - strip.gapIndex

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
              column={i < strip.gapIndex ? i + 1 : i + 2}
            />
          ))}

          <div
            ref={gapRef}
            className="strip__gap"
            style={{ gridColumn: strip.gapIndex + 1 }}
            aria-label="where this book goes"
          />

          <div className="strip__shelf" />

          <div className="strip__new" style={{ gridColumn: strip.gapIndex + 1 }}>
            <span className="strip__new-author">{authorFiling || 'this book'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Spine({
  book, position, column,
}: {
  book: PlacementStrip['books'][number]
  position: number
  column: number
}) {
  const photo = coverUrl(book.spine)

  return (
    <div
      className={photo ? 'spine spine--known' : 'spine'}
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
