/**
 * Lists of books, and the small marks that go on them.
 *
 * A row is a book most of the time, so it is built for one: the spine or
 * cover on the left at the proportions a book actually has, the title in the
 * book face, the author under it, and where it lives on the right in tabular
 * figures so a column of plank labels lines up.
 */

import type { ReactNode } from 'react'
import { Cat } from './Cat'
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
 *
 * ## The second tone, and why it is not the split coming back
 *
 * `wants` is a book saying it needs a person: the queue's diagnosis, which is
 * #148 and is the one thing on that screen somebody acts on. That is the same
 * kind of fact `on` is, about what is true on the screen right now, and not the
 * kind the tint was taken off for: fiction and non-fiction were painted because
 * of which tag they were, so a person keeping twenty tags had two of them lit
 * for no reason anybody could act on. Nothing here is ever tinted for being a
 * particular tag, and nothing is ever told by the tint alone: every one of
 * these carries its word, which `design.test.tsx` checks on every screen.
 */
export function Tag({
  children,
  tone,
  onPress,
}: {
  children: ReactNode
  tone?: 'on' | 'wants'
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

/**
 * A row of them, wrapping.
 *
 * A span rather than a div, for the reason the book's own arrangement is one: a
 * queue row is a single button and a `<div>` inside a `<button>` is not
 * phrasing content. The rule sets `display: flex` itself, so the row is the row
 * it always was.
 */
export function Tags({ children }: { children: ReactNode }) {
  return <span className="wf-tags">{children}</span>
}

/** A plank label, set the way it reads off the shelf edge. */
export function Place({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <span className={`wf-place${quiet ? ' wf-place--quiet' : ''}`}>{children}</span>
}

/**
 * The counts, three across and wrapping, with the cat at the end of them.
 *
 * **A count with an `onPress` is a target rather than a label**, and on the
 * first screen every one of them has one. The owner asked for that screen to
 * be metrics and nothing else, and a metric nobody can act on is decoration:
 * six ready to shelve opens the queue, three to carry opens the carry list. Its
 * accessible name is the number and the word together, which is what somebody
 * would say out loud.
 *
 * ## Five of them, ungrouped, since #361
 *
 * > So we get rid of the collection, and we get rid of "needs you", and instead
 * > we just have those numbers there: catalogued, checked out, ready to shelve,
 * > to carry, stuck.
 *
 * Three is still the width, because a fourth column at 414 wide puts a word
 * like "ready to shelve" into 93px; what changed is that they now wrap, so five
 * counts are three and two rather than a heading and a heading. The row used to
 * flow as a single line of columns so that a count the catalogue had not
 * answered yet left two sharing the width instead of a hole, and wrapping keeps
 * that: a missing count closes up.
 *
 * ## And the cat sits at the end of them
 *
 * > We still should have the cat icon on this screen though, because it's cute.
 *
 * The sentence he sat beside is gone, so he needs somewhere to be, and the
 * sixth cell of a five-count grid is somewhere he already belongs: closing a
 * run is one of the three jobs he has. He is drawn here rather than handed in
 * so the gallery and the app cannot end up with two cats at two sizes.
 *
 * **He is asleep when the whole collection is**, which is the one thing on this
 * screen that says a wall of zeros is a new collection rather than a broken
 * one, and it costs no sentence to say it.
 */
export function Stats({
  items,
  cat,
}: {
  items: { n: string; word: string; onPress?: () => void }[]
  /** The bookend: sitting on an ordinary day, asleep when there is nothing. */
  cat?: 'sitting' | 'sleeping'
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
      {cat && (
        <div className="wf-stats__cat">
          <Cat pose={cat} size={cat === 'sitting' ? 58 : 40} />
        </div>
      )}
    </div>
  )
}
