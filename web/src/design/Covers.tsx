/**
 * The gallery: books as their covers, three across. Uses the same six cloths
 * the board uses, so a book is the same colour in every view of it. Three
 * across at 414 wide: two makes a page of posters and four makes the title
 * unreadable.
 */

import type { Cloth } from './Shelf'

export interface CoverItem {
  title: string
  /**
   * Whoever it is filed under. Empty for a book nobody is credited on, a real
   * state rather than a missing field: never falls back to "Unknown author".
   * The line is drawn either way, to keep tiles the same height.
   */
  author: string
  cloth?: Cloth
  /** A word instead of a place: "Checked out". */
  meta?: string
  /** Where it lives, as it reads off the furniture. Not on the library's wall of covers, only the find results, since somebody who just searched is usually about to go fetch it. */
  place?: string
  /** The book itself, in the app. The cloth stays underneath either way, so a picture that has not arrived is a bound book rather than a grey hole. */
  photo?: string
  /** Two copies of one book are two books; the title and author stand in when nothing else does. */
  id?: number | string
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
  /**
   * Open one. It is given the cover pressed, so a wireframe screen can keep
   * passing a function that takes nothing and the app can open the book.
   */
  onPress?: (item: CoverItem) => void
}) {
  return (
    <div className="wf-covers" role="list" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id ?? `${item.title}-${item.author}`}
          type="button"
          role="listitem"
          className="wf-cover"
          /* Said explicitly, since a cover with a photograph has no words in it at all; the title alone where nobody is credited, never "Unknown author". */
          aria-label={item.author ? `${item.title}, ${item.author}` : item.title}
          onClick={() => onPress?.(item)}
        >
          <span className={`wf-cover__art wf-spine--${item.cloth ?? 'wood'}`}>
            {item.photo ? (
              /* `alt` is empty on purpose: the title and author are read out via `aria-label` above, so a title on the image too would say everything twice. */
              <img className="wf-cover__photo" src={item.photo} alt="" loading="lazy" decoding="async" />
            ) : (
              <span className="wf-cover__printed">{item.title}</span>
            )}
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
