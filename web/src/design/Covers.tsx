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
  /**
   * Whoever it is filed under, and **empty for a book nobody is credited on**.
   *
   * That is a real state and not a missing field. An uncredited book falls back
   * to what the book itself carries and then to nothing, never to the words
   * "Unknown author", so a tile for one is its cover with a blank line under
   * it. The line is drawn either way, which is what keeps the tiles beside it
   * the same height.
   */
  author: string
  cloth?: Cloth
  /** A word instead of a place: "Checked out". */
  meta?: string
  /**
   * Where it lives, as it reads off the furniture.
   *
   * **Not on the library's wall of covers**, which since #407 is a cover and a
   * name and nothing else. The find results still carry it, because that is a
   * different question: somebody who has just searched for one book is usually
   * on their way to go and fetch it.
   */
  place?: string
  /**
   * The book itself, in the app: the cover somebody photographed or the one the
   * catalogue downloaded. Absent in the gallery, which has no photographs, and
   * absent for a real book nobody has photographed yet, which is most of them.
   *
   * The cloth stays underneath either way, so a picture that has not arrived is
   * a book in a dyed binding rather than a grey hole.
   */
  photo?: string
  /**
   * Two copies of one book are two books, so the drawing needs to tell them
   * apart. The title and the author are what stands in when nothing else does.
   */
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
          /*
           * Said, because a cover with a photograph on it has no words in it at
           * all: the title is printed in the picture and a picture is not text.
           * The cloth version draws the title and would read fine without this,
           * and one name for both is one thing to keep true.
           *
           * The title alone where nobody is credited. "The Anglo-Saxon
           * Chronicle, " read out with a comma and then silence is a screen
           * reader announcing a field that is not there, which is the spoken
           * version of "Unknown author" and is refused for the same reason.
           */
          aria-label={item.author ? `${item.title}, ${item.author}` : item.title}
          onClick={() => onPress?.(item)}
        >
          <span className={`wf-cover__art wf-spine--${item.cloth ?? 'wood'}`}>
            {item.photo ? (
              /*
               * Over the cloth rather than instead of it, so a picture still
               * loading is a bound book and not a hole. `alt` is empty on
               * purpose: the title and the name are drawn under it and read out
               * with it, and a picture announced by its own title says
               * everything twice.
               */
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
