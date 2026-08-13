/**
 * Lists of books, and the small marks that go on them.
 *
 * A row is a book most of the time, so it is built for one: the spine or
 * cover on the left at the proportions a book actually has, the title in the
 * book face, the author under it, and where it lives on the right in tabular
 * figures so a column of plank labels lines up.
 */

import type { ReactNode } from 'react'
import { IconOnward } from './Icons'
import type { Cloth } from './Shelf'

export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="wf-list" role="list" aria-label={label}>
      {children}
    </div>
  )
}

export function Row({
  title,
  sub,
  cloth,
  photo,
  place,
  meta,
  onward = true,
  onPress,
}: {
  title: string
  sub?: string
  /** The binding of the thumbnail, standing in for the photograph. */
  cloth?: Cloth
  /**
   * The photograph itself, where there is one. The cloth stays underneath it,
   * so a book nobody has photographed and a picture still arriving both look
   * like a bound book rather than a gap.
   */
  photo?: string
  /** Where it lives: `2C`. Tabular, so a column of them lines up. */
  place?: string
  /** A word instead of a place: "Checked out", "Needs an ISBN". */
  meta?: string
  onward?: boolean
  onPress?: () => void
}) {
  return (
    <button type="button" className="wf-row" role="listitem" onClick={onPress}>
      <span className={`wf-row__thumb wf-spine--${cloth ?? 'wood'}`} aria-hidden="true">
        {photo && <img className="wf-row__photo" src={photo} alt="" loading="lazy" decoding="async" />}
      </span>
      <span className="wf-row__text">
        <span className="wf-row__title">{title}</span>
        {sub && <span className="wf-row__sub">{sub}</span>}
      </span>
      <span className="wf-row__meta">
        {place && <span className="wf-row__place">{place}</span>}
        {meta && <span>{meta}</span>}
        {onward && !place && !meta && <IconOnward size={18} />}
      </span>
    </button>
  )
}

/**
 * A word, boxed. The word carries the meaning and the tint says one thing only.
 *
 * **There is no tint for a particular tag any more.** Fiction was green and
 * non-fiction was blue, which was the two-way split wearing a coat: a person
 * keeping twenty tags would have had two of them painted and eighteen plain,
 * and nothing in the model says those two are different from the rest. The one
 * tone left says a tag is *doing something right now*, which is a fact about
 * the screen rather than about the tag.
 *
 * Given an `onPress` it becomes a target rather than a label, which is what a
 * tag is on any screen where the tags are the thing being edited.
 */
export function Tag({
  children,
  tone,
  onPress,
}: {
  children: ReactNode
  tone?: 'on'
  onPress?: () => void
}) {
  const className = [
    'wf-tag',
    tone ? `wf-tag--${tone}` : '',
    onPress ? 'wf-tag--press' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (onPress) {
    return (
      <button type="button" className={className} onClick={onPress}>
        {children}
      </button>
    )
  }

  return <span className={className}>{children}</span>
}

/**
 * Another tag, at the end of the ones there already are.
 *
 * Dashed, because it is the shape of a thing that is not there yet. The same
 * move `AddBox` makes under a piece of furniture, and it should look like it.
 */
export function AddTag({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <button type="button" className="wf-tag wf-tag--press wf-tag--add" onClick={onPress}>
      {children}
    </button>
  )
}

export function Tags({ children }: { children: ReactNode }) {
  return <div className="wf-tags">{children}</div>
}

/** A plank label, set the way it reads off the shelf edge. */
export function Place({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <span className={`wf-place${quiet ? ' wf-place--quiet' : ''}`}>{children}</span>
}

/**
 * Three counts in a row. Three, because a fourth does not fit at 414 wide
 * without the words wrapping to three lines each.
 *
 * **A count with an `onPress` is a target rather than a label**, and on the
 * first screen every one of them has one. The owner asked for that screen to
 * be metrics and nothing else, and a metric nobody can act on is decoration:
 * six ready to shelve opens the queue, three to carry opens the carry list. Its
 * accessible name is the number and the word together, which is what somebody
 * would say out loud.
 */
export function Stats({
  items,
}: {
  items: { n: string; word: string; onPress?: () => void }[]
}) {
  return (
    <div className="wf-stats">
      {items.map((item) => {
        const inside = (
          <>
            <span className="wf-stat__n">{item.n}</span>
            <span className="wf-stat__word">{item.word}</span>
          </>
        )

        return item.onPress ? (
          <button
            type="button"
            className="wf-stat wf-stat--press"
            key={item.word}
            onClick={item.onPress}
          >
            {inside}
          </button>
        ) : (
          <div className="wf-stat" key={item.word}>
            {inside}
          </div>
        )
      })}
    </div>
  )
}
