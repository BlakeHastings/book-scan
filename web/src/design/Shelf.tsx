/**
 * The shelf, which is the signature of this app.
 *
 * A board drawn end on, with the books standing on it, the gap where the book
 * in your hand goes, and the cat as the bookend that closes it.
 *
 * **One board is one area, and nothing divides it.** There used to be a
 * `divider` item, a post drawn between two spines to say that one area ended
 * there and the next began. The owner read it on the library screen and named
 * what was wrong:
 *
 * > A is an area itself, so it really would be bookcase one, 1A, and then
 * > underneath that would be another row that's 1B. You wouldn't have this
 * > actual physical split like you have there.
 *
 * An area is the unit. A row of books is one area, the next area is the next
 * row, and a split partway along a row labelled `1A` claimed that `1A` holds
 * areas. Nothing here has ever known which areas share a plank, so there was
 * never anything for that post to be a picture of.
 *
 * **The board has one edge.** It is the lip the books stand on, and it is the
 * bottom border of `.wf-shelf__board`. There is no second bar under it and
 * there must not be: a board drawn twice is the first thing anybody notices.
 *
 * **It scrolls inside itself and the page does not.** A shelf is wider than a
 * phone and always will be, and the alternative, wrapping it, would draw
 * furniture that is not in the room: a break means "new area" everywhere else
 * here. Native overflow rather than a drag handler, for the reason
 * `src/components/ShelfStrip.tsx` gives.
 *
 * ## How big a spine is allowed to be, which is a question about honesty
 *
 * The first pass varied both width and height from the index of the book in
 * the list, which is to say from nothing. The owner liked the variation and
 * then caught what was under it:
 *
 * > I think we're gonna face some problems with presenting the books by size.
 * > I don't think we have any metrics to make that possible. But I do like the
 * > fact that they are different sizes. It's gonna be odd when we're rendering
 * > the spines there, and if the book isn't tall but we show it as tall, right?
 *
 * He is right. **The catalogue holds no height.** It holds `pages`, which is a
 * measurement of the *other* axis: how thick the book is. So width is the one
 * dimension that can be drawn from something true, and it is drawn from it
 * here.
 *
 * **Height is uniform, and that is settled** (#273):
 *
 * > We should stick with flat tops, and we can do the width based off of the
 * > page count if we want. The problem is we don't always have the page count.
 *
 * There was a second variant for a round, which estimated a height from the
 * shape of a spine crop. It was drawn beside the flat one so the choice could
 * be made by looking, the choice was made, and it is gone with the screen it
 * was compared on. Every book on every shelf is one height, and there is no
 * second answer here to reintroduce.
 *
 * ## The fourth book, which has no page count
 *
 * The gap is measured rather than guessed. Against the live catalogue on
 * 2026-08-12: **183 of 238 books carry a page count, 77%.** Those that do run
 * from 54 pages to 1168, with a median of 339. So roughly one book in four has
 * no honest width, and what happens to that book decides how a shelf reads.
 *
 * **It is drawn at the width the median page count gives**, which is 27px. Not
 * a visibly odd width, and not every book the same: a shelf is a picture of a
 * room rather than a chart, and a quarter of the books shouting that a field is
 * empty would be a chart. It is a mild fiction of exactly the kind flat tops
 * already is, it is bounded by the real range on both sides, and it shrinks on
 * its own, because a page count arrives with the catalogue lookup and books
 * gain one over time.
 *
 * The alternatives, so nobody has to rediscover them: a deliberately different
 * width, which is honest and makes a quarter of the shelf look broken, and one
 * width for every book, which is truthful and throws away the variation the
 * owner liked in the first place.
 */

import type { CSSProperties } from 'react'
import { Cat } from './Cat'

/** The dyed cloths a placeholder spine can be bound in. */
export type Cloth = 'moss' | 'plum' | 'sky' | 'sun' | 'wood' | 'wood2'

const CLOTHS: Cloth[] = ['moss', 'wood', 'sky', 'plum', 'wood2', 'sun']

/**
 * The median page count in the catalogue, and the width a book with no page
 * count is drawn at.
 *
 * Measured, not chosen: 183 of the 238 books held a page count on 2026-08-12,
 * running 54 to 1168, and 339 was the middle of them. Written down here as the
 * one number the fallback comes from, so that when the catalogue's median moves
 * there is a single place that is out of date rather than a magic width nobody
 * can trace.
 */
export const MEDIAN_PAGES = 339

export type ShelfItem =
  | {
      kind: 'spine'
      /** Written down the spine, the way it is printed. */
      text: string
      cloth?: Cloth
      /**
       * The one measurement the catalogue actually holds. It decides the
       * width, because pages are thickness and thickness is width seen end on.
       *
       * Absent for about one book in four, which is a fact about the catalogue
       * rather than about this type. See `spineWidth`.
       */
      pages?: number
      /** The book this screen is about, already in place. */
      here?: boolean
    }
  | { kind: 'gap' }
  | { kind: 'bookend' }

const clamp = (low: number, value: number, high: number) =>
  Math.min(high, Math.max(low, value))

/** How tall every spine is drawn, because nothing measures a book's height. */
export const SPINE_HEIGHT = 116

/**
 * How wide to draw a book, in pixels.
 *
 * **Not to scale, and it cannot be.** At the scale that makes a 200mm book
 * 116px tall, a 24mm spine is 14px, and 14px is narrower than the type printed
 * down it. So the width is exaggerated and the *ordering* is what is true: a
 * thicker book is drawn wider than a thinner one, always, and the range of
 * real books lands inside a range a phone can draw.
 *
 * **A book with no page count is drawn at the median**, and that is a decision
 * rather than a default. It is the one place here where a number reaching the
 * screen did not come off the book, so it is spelled out: it lands at 27px,
 * between the 16px the thinnest real book gets and the 56px the thickest does,
 * and it makes an unknown book look like an ordinary one instead of like a
 * missing field. The header says why that is the right lie to tell.
 */
export function spineWidth(pages?: number): number {
  return Math.round(clamp(16, 12 + (pages ?? MEDIAN_PAGES) / 22, 56))
}

/**
 * A run of books from a list of names, for the gallery.
 *
 * The page counts are derived from the name rather than written out, so the
 * same book is the same thickness on every screen it appears on and nobody has
 * to keep two lists in step. In the app these are rows and photographs; this
 * is standing in for them, not decorating.
 *
 * **One name in four gets no page count at all**, which is the other half of
 * that. The live catalogue is missing one on 23% of its books, so a fixture
 * where every book has one would draw a shelf nobody will ever see, and the
 * fallback width would be the one thing in the system that only ever appeared
 * in a test. It is the hash that decides which, so a given book is missing its
 * count on every screen it appears on, and the misses are scattered rather than
 * every fourth: six of the gallery's thirty, which is what a real plank looks
 * like.
 */
export function spines(names: string[], from = 0): ShelfItem[] {
  return names.map((text, i) => {
    let hash = 0
    for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 9973
    return {
      kind: 'spine' as const,
      text,
      cloth: CLOTHS[(i + from) % CLOTHS.length],
      // 96 to 928 pages, which is the range a shelf of novels really covers,
      // and undefined for the one in four the catalogue cannot answer for.
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
  return (
    <section className="wf-shelf" aria-label={`Area ${label}`}>
      <header className="wf-shelf__head">
        <span className="wf-shelf__label">{label}</span>
        {note && <span className="wf-shelf__note">{note}</span>}
      </header>

      <div className="wf-shelf__scroll">
        <div className="wf-shelf__board">
          {items.map((item, i) => (
            <Item key={i} item={item} />
          ))}
        </div>
      </div>

      {/* No cat on this line. He is already in the gap and again at the end of
          the books, and three of him on one screen stopped being a mascot and
          started being a pattern. Found by looking at it. */}
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

  const className = [
    'wf-spine',
    `wf-spine--${item.cloth ?? 'wood'}`,
    item.here ? 'wf-spine--here' : '',
  ]
    .filter(Boolean)
    .join(' ')

  /*
   * Inline, because these are measurements of one book rather than a style. A
   * class per size would be a lookup table of every page count there is.
   */
  const size: CSSProperties = {
    width: spineWidth(item.pages),
    height: SPINE_HEIGHT,
  }

  return (
    <div className={className} style={size} title={item.text}>
      <span className="wf-spine__text">{item.text}</span>
    </div>
  )
}
