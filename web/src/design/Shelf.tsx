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
 * here. Height is uniform by default, because a height nobody measured is a
 * height we would be inventing, and a shelf of varied thicknesses already
 * reads as a shelf.
 *
 * The second variant, `heights="photograph"`, is in the gallery beside the
 * first so the choice is made by looking rather than by argument. It uses the
 * one other real measurement available: a spine crop has a true **aspect
 * ratio** even though its scale depends on how far away the camera was. Given
 * a thickness in millimetres from `pages`, that ratio yields a height in
 * millimetres, and books really are between about 150mm and 260mm tall, so the
 * estimate can be mapped onto a band and clamped. Honest in proportion,
 * dependent on a crop being tight, and it fails quietly rather than loudly:
 * a bad crop makes a book the wrong height, not an absurd one.
 */

import type { CSSProperties } from 'react'
import { Cat } from './Cat'

/** The dyed cloths a placeholder spine can be bound in. */
export type Cloth = 'moss' | 'plum' | 'sky' | 'sun' | 'wood' | 'wood2'

const CLOTHS: Cloth[] = ['moss', 'wood', 'sky', 'plum', 'wood2', 'sun']

/** Which of the two answers to "how tall is this book" a shelf is drawing. */
export type Heights = 'uniform' | 'photograph'

export type ShelfItem =
  | {
      kind: 'spine'
      /** Written down the spine, the way it is printed. */
      text: string
      cloth?: Cloth
      /**
       * The one measurement the catalogue actually holds. It decides the
       * width, because pages are thickness and thickness is width seen end on.
       */
      pages?: number
      /**
       * Height divided by thickness, as the spine photograph has it. Read only
       * by `heights="photograph"`, and absent for a book nobody has
       * photographed yet.
       */
      ratio?: number
      /** The book this screen is about, already in place. */
      here?: boolean
    }
  | { kind: 'gap' }
  | { kind: 'bookend' }

const clamp = (low: number, value: number, high: number) =>
  Math.min(high, Math.max(low, value))

/**
 * Millimetres of spine for a page count: two covers plus the paper.
 *
 * 0.062mm a leaf is ordinary uncoated book stock, and 4mm covers a pair of
 * boards or a card wrap. A 320 page novel comes out at 24mm, which is what a
 * ruler says about one.
 */
function thicknessMm(pages: number): number {
  return 4 + pages * 0.062
}

/**
 * How wide to draw that, in pixels.
 *
 * **Not to scale, and it cannot be.** At the scale that makes a 200mm book
 * 116px tall, a 24mm spine is 14px, and 14px is narrower than the type printed
 * down it. So the width is exaggerated and the *ordering* is what is true: a
 * thicker book is drawn wider than a thinner one, always, and the range of
 * real books lands inside a range a phone can draw.
 */
export function spineWidth(pages?: number): number {
  if (!pages) return 30
  return Math.round(clamp(16, 12 + pages / 22, 56))
}

/**
 * How tall, when the crop is being believed.
 *
 * The band is 96 to 140px because real books are roughly 150 to 260mm tall,
 * and the clamp is what keeps a bad crop from drawing a book the height of the
 * screen. A book with no photograph gets the uniform height, which is the same
 * thing as saying we do not know.
 */
export function spineHeight(pages?: number, ratio?: number): number {
  if (!pages || !ratio) return 116
  const mm = thicknessMm(pages) * ratio
  return Math.round(clamp(96, 96 + ((mm - 150) / 110) * 44, 140))
}

/**
 * A run of books from a list of names, for the gallery.
 *
 * The page counts are derived from the name rather than written out, so the
 * same book is the same thickness on every screen it appears on and nobody has
 * to keep two lists in step. In the app these are rows and photographs; this
 * is standing in for them, not decorating.
 */
export function spines(names: string[], from = 0): ShelfItem[] {
  return names.map((text, i) => {
    let hash = 0
    for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 9973
    return {
      kind: 'spine' as const,
      text,
      cloth: CLOTHS[(i + from) % CLOTHS.length],
      // 96 to 928 pages, which is the range a shelf of novels really covers.
      pages: 96 + (hash % 52) * 16,
      // 5.5 to 11.5, thin hardback to fat mass market paperback.
      ratio: 5.5 + (hash % 13) / 2,
    }
  })
}

export function Shelf({
  label,
  note,
  items,
  inHand,
  heights = 'uniform',
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
  /** Which answer to "how tall is this book" to draw. See the header. */
  heights?: Heights
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
            <Item key={i} item={item} heights={heights} />
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

function Item({ item, heights }: { item: ShelfItem; heights: Heights }) {
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
    height: heights === 'photograph' ? spineHeight(item.pages, item.ratio) : 116,
  }

  return (
    <div className={className} style={size} title={item.text}>
      <span className="wf-spine__text">{item.text}</span>
    </div>
  )
}
