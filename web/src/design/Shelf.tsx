/**
 * The shelf: a board drawn end on, with the books standing on it, the gap
 * where the book in your hand goes, and the cat as the bookend that closes it.
 *
 * One board is one area; nothing divides it, since nothing here knows which
 * areas share a plank. The board has one edge, the bottom border of
 * `.wf-shelf__board`; there must not be a second bar under it. It scrolls
 * inside itself and the page does not, using native overflow rather than a
 * drag handler; see `src/components/ShelfStrip.tsx`.
 *
 * The catalogue holds no height, only `pages` (thickness), so a book's drawn
 * width comes from its page count and every spine is drawn at one uniform
 * height. A book with no page count is drawn at the median rather than a
 * visibly different width, deliberately: see `spineWidth`.
 *
 * The book a screen is about is marked by the cat standing on it rather than
 * by an outline around it: an outline with a positive offset draws outside the
 * element, which the scroller (`overflow-y: hidden`) then clips. `wf-perch`
 * gives the cat room by growing the board upward above the marked book instead.
 */

import { useEffect, useRef, type CSSProperties } from 'react'
import { Cat } from './Cat'

/** The dyed cloths a placeholder spine can be bound in. */
export type Cloth = 'moss' | 'plum' | 'sky' | 'sun' | 'wood' | 'wood2'

const CLOTHS: Cloth[] = ['moss', 'wood', 'sky', 'plum', 'wood2', 'sun']

/** The median page count in the catalogue, measured rather than chosen. Used as the fallback for a book with no page count. */
export const MEDIAN_PAGES = 339

export type ShelfItem =
  | {
      kind: 'spine'
      /** Written down the spine, the way it is printed. */
      text: string
      /**
       * What this spine is called for anybody not looking at pixels. Falls
       * back to `text` (the filing name) where a screen has nothing better;
       * the app passes the title instead, since a run announced by filing
       * name eleven times says which shelf you are on and never which book.
       * See `spineLabel` in `lib/shelfRow.ts`.
       */
      name?: string
      cloth?: Cloth
      /** The one measurement the catalogue actually holds; decides the drawn width. See `spineWidth`. */
      pages?: number
      /** The book this screen is about, already in place. */
      here?: boolean
      /**
       * The photograph of this book's spine, where the catalogue has one. The
       * cloth stays underneath it so a picture still arriving is a bound book
       * rather than a gap in the row.
       */
      photo?: string
      /** Walk along the shelf: open the book this spine is. */
      onPress?: () => void
    }
  | { kind: 'gap' }
  | { kind: 'bookend' }

const clamp = (low: number, value: number, high: number) =>
  Math.min(high, Math.max(low, value))

/** How tall every spine is drawn, because nothing measures a book's height. */
export const SPINE_HEIGHT = 116

/**
 * How tall the cat is when he is sitting on the book a screen is about. Also
 * the room reserved above the book, handed to the stylesheet as `--perch`, so
 * the two cannot drift apart and clip him.
 */
export const CAT_ON_TOP = 26

/**
 * How wide to draw a book, in pixels. Not to scale: at true scale a spine
 * would be narrower than the type printed down it, so only the ordering is
 * true, a thicker book always drawn wider than a thinner one. A book with no
 * page count is drawn at the median (27px) rather than a visibly different
 * width; see the file header.
 */
export function spineWidth(pages?: number): number {
  return Math.round(clamp(16, 12 + (pages ?? MEDIAN_PAGES) / 22, 56))
}

/**
 * A run of books from a list of names, for the gallery. Page counts are
 * derived from the name's hash rather than written out, so the same book is
 * the same thickness on every screen. One in four names gets no page count,
 * so the fallback width is exercised here too rather than only in a test.
 */
export function spines(names: string[], from = 0): ShelfItem[] {
  return names.map((text, i) => {
    let hash = 0
    for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 9973
    return {
      kind: 'spine' as const,
      text,
      cloth: CLOTHS[(i + from) % CLOTHS.length],
      // 96 to 928 pages, undefined for one book in four.
      pages: hash % 4 === 0 ? undefined : 96 + (hash % 52) * 16,
    }
  })
}

export function Shelf({
  label,
  note,
  items,
  inHand,
}: {
  /**
   * The area this row is, as it is read off the shelf edge: `2C`. Derived
   * from the piece's name and the area's position, and never stored.
   */
  label: string
  /** Whatever else this row needs said, in words. Counts, usually. */
  note?: string
  items: ShelfItem[]
  /** The book being carried, said under the plank rather than drawn on it. */
  inHand?: string
}) {
  const scroller = useRef<HTMLDivElement>(null)

  /**
   * A run is wider than a phone, so the marked book has to be brought into
   * view. `block: 'nearest'` scrolls the strip sideways without moving the page.
   */
  useEffect(() => {
    const here = scroller.current?.querySelector('.wf-perch')
    here?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [items])

  return (
    <section className="wf-shelf" aria-label={`Area ${label}`}>
      <header className="wf-shelf__head">
        <span className="wf-shelf__label">{label}</span>
        {note && <span className="wf-shelf__note">{note}</span>}
      </header>

      <div className="wf-shelf__scroll" ref={scroller}>
        <div className="wf-shelf__board">
          {items.map((item, i) => (
            <Item key={i} item={item} />
          ))}
        </div>
      </div>

      {/* No cat on this line, deliberately: he is already in the gap and at the end of the books. */}
      {inHand && <p className="wf-shelf__inhand">In your hand: {inHand}</p>}
    </section>
  )
}

function Item({ item }: { item: ShelfItem }) {
  if (item.kind === 'gap') {
    return (
      <div className="wf-gap" aria-label="where this book goes">
        <Cat pose="peeking" size={20} />
      </div>
    )
  }

  if (item.kind === 'bookend') {
    return (
      <div className="wf-bookend">
        <Cat pose="sitting" size={54} />
      </div>
    )
  }

  const className = ['wf-spine', `wf-spine--${item.cloth ?? 'wood'}`].join(' ')

  const size: CSSProperties = {
    width: spineWidth(item.pages),
    height: SPINE_HEIGHT,
  }

  const inside = item.photo ? (
    <img className="wf-spine__photo" src={item.photo} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className="wf-spine__text">{item.text}</span>
  )

  const spine = item.onPress ? (
    <button
      type="button"
      className={className}
      style={size}
      title={item.name ?? item.text}
      aria-label={item.name ?? item.text}
      onClick={item.onPress}
    >
      {inside}
    </button>
  ) : (
    <div className={className} style={size} title={item.name ?? item.text}>
      {inside}
    </div>
  )

  if (!item.here) return spine

  return (
    <div
      className="wf-perch"
      style={{ '--perch': `${CAT_ON_TOP}px` } as CSSProperties}
    >
      <Cat pose="peeking" size={CAT_ON_TOP} label="This is the book" className="wf-perch__cat" />
      {spine}
    </div>
  )
}
