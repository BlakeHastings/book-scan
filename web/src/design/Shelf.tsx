/**
 * The shelf, which is the signature of this app.
 *
 * A plank drawn end on, with the run of spines standing on it, the divider
 * where one area ends and the next begins, the gap where the book in your
 * hand goes, and the cat as the bookend that closes the run.
 *
 * **The board has one edge.** It is the lip the books stand on, and it is the
 * bottom border of `.wf-shelf__board`. There is no second bar under it and
 * there must not be: a board drawn twice is the first thing anybody notices.
 *
 * **The run scrolls inside itself and the page does not.** A shelf is wider
 * than a phone and always will be, and the alternative, wrapping it, would
 * draw furniture that is not in the room: a break in a run means "new area"
 * everywhere else here. Native overflow rather than a drag handler, for the
 * reason `src/components/ShelfStrip.tsx` gives.
 */

import { Cat } from './Cat'

/** The dyed cloths a placeholder spine can be bound in. */
export type Cloth = 'moss' | 'plum' | 'sky' | 'sun' | 'wood' | 'wood2'

const CLOTHS: Cloth[] = ['moss', 'wood', 'sky', 'plum', 'wood2', 'sun']

export type ShelfItem =
  | {
      kind: 'spine'
      /** Written down the spine, the way it is printed. */
      text: string
      cloth?: Cloth
      height?: 'tall' | 'short'
      width?: 'wide' | 'slim'
      /** The book this screen is about, already in place. */
      here?: boolean
    }
  | { kind: 'gap' }
  | { kind: 'divider' }
  | { kind: 'bookend' }

/**
 * A run of spines from a list of names, bound in cloths that vary so the run
 * reads as books rather than as a bar chart. In the app these are
 * photographs; the variation is standing in for that, not decorating it.
 */
export function spines(names: string[], from = 0): ShelfItem[] {
  return names.map((text, i) => ({
    kind: 'spine' as const,
    text,
    cloth: CLOTHS[(i + from) % CLOTHS.length],
    height: i % 5 === 2 ? ('short' as const) : i % 7 === 3 ? ('tall' as const) : undefined,
    width: i % 4 === 1 ? ('wide' as const) : i % 6 === 5 ? ('slim' as const) : undefined,
  }))
}

export function Shelf({
  label,
  note,
  items,
  inHand,
}: {
  /** The plank, as it is read off the shelf edge: `2C`. */
  label: string
  /** Whatever else this run needs said, in words. Counts, usually. */
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
          the run, and three of him on one screen stopped being a mascot and
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

  if (item.kind === 'divider') {
    return <div className="wf-divider" aria-hidden="true" />
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
    item.height ? `wf-spine--${item.height}` : '',
    item.width ? `wf-spine--${item.width}` : '',
    item.here ? 'wf-spine--here' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} title={item.text}>
      <span className="wf-spine__text">{item.text}</span>
    </div>
  )
}
