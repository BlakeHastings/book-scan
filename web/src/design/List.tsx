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
  place,
  meta,
  onward = true,
  onPress,
}: {
  title: string
  sub?: string
  /** The binding of the thumbnail, standing in for the photograph. */
  cloth?: Cloth
  /** Where it lives: `2C`. Tabular, so a column of them lines up. */
  place?: string
  /** A word instead of a place: "Checked out", "Needs an ISBN". */
  meta?: string
  onward?: boolean
  onPress?: () => void
}) {
  return (
    <button type="button" className="wf-row" role="listitem" onClick={onPress}>
      <span className={`wf-row__thumb wf-spine--${cloth ?? 'wood'}`} aria-hidden="true" />
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
 */
export function Tag({ children, tone }: { children: ReactNode; tone?: 'on' }) {
  return <span className={`wf-tag${tone ? ` wf-tag--${tone}` : ''}`}>{children}</span>
}

export function Tags({ children }: { children: ReactNode }) {
  return <div className="wf-tags">{children}</div>
}

/** A plank label, set the way it reads off the shelf edge. */
export function Place({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <span className={`wf-place${quiet ? ' wf-place--quiet' : ''}`}>{children}</span>
}

/**
 * The three counts on the first screen. Three, because a fourth does not fit
 * at 414 wide without the words wrapping to three lines each.
 */
export function Stats({ items }: { items: { n: string; word: string }[] }) {
  return (
    <div className="wf-stats">
      {items.map((item) => (
        <div className="wf-stat" key={item.word}>
          <span className="wf-stat__n">{item.n}</span>
          <span className="wf-stat__word">{item.word}</span>
        </div>
      ))}
    </div>
  )
}
