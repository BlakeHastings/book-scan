/**
 * The gallery: books as their covers, three across.
 *
 * This is the view searching drops you into, because a cover is the fastest
 * thing to recognise when you already know roughly what you are after. The
 * list is for scanning a column of authors and the board is for finding a book
 * in the room; this one is for "that one, the green one".
 *
 * **The art is standing in for a photograph.** In the app every one of these
 * is the cover the catalogue already downloaded or the front you took. Here it
 * is dyed cloth with the title printed on it, which is what a book with no
 * jacket looks like, and it is the same six cloths the board uses so a book is
 * the same colour in every view of it.
 *
 * Three across at 414 wide. Two makes a page of posters and four makes the
 * title unreadable, and both were drawn before this comment was written.
 */

import type { Cloth } from './Shelf'

export interface CoverItem {
  title: string
  author: string
  cloth?: Cloth
  /** A word instead of a place: "Checked out". */
  meta?: string
  /** Where it lives, as it reads off the furniture. */
  place?: string
}

/**
 * Covers from a list of title and author pairs, so the same book is the same
 * colour wherever it turns up and nobody keeps two lists in step.
 */
export function covers(items: [string, string][], from = 0): CoverItem[] {
  const CLOTHS: Cloth[] = ['moss', 'wood', 'sky', 'plum', 'wood2', 'sun']
  return items.map(([title, author], i) => ({
    title,
    author,
    cloth: CLOTHS[(i + from) % CLOTHS.length],
  }))
}

export function Covers({
  items,
  label,
  onPress,
}: {
  items: CoverItem[]
  label: string
  onPress?: () => void
}) {
  return (
    <div className="wf-covers" role="list" aria-label={label}>
      {items.map((item) => (
        <button
          key={`${item.title}-${item.author}`}
          type="button"
          role="listitem"
          className="wf-cover"
          onClick={onPress}
        >
          <span className={`wf-cover__art wf-spine--${item.cloth ?? 'wood'}`}>
            <span className="wf-cover__printed">{item.title}</span>
          </span>
          <span className="wf-cover__by">{item.author}</span>
          {(item.place || item.meta) && (
            <span className="wf-cover__meta">{item.place ?? item.meta}</span>
          )}
        </button>
      ))}
    </div>
  )
}
