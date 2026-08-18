/**
 * Lists of books, and the small marks that go on them.
 *
 * A row is a book most of the time, so it is built for one: the spine or
 * cover on the left at the proportions a book actually has, the title in the
 * book face, the author under it, and where it lives on the right in tabular
 * figures so a column of plank labels lines up.
 */

import type { ReactNode } from 'react'
import { Cat, type CatDoing } from './Cat'
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
  off = false,
  label,
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
  /**
   * A word instead of a place: "Checked out", "Needs an ISBN".
   *
   * More than one where a row genuinely has more than one thing to say at its
   * end, which is why this takes nodes rather than a string. The rule was
   * already a stacking grid ending at the right margin, because a place and a
   * word have always been able to appear together; the shortlist a cover match
   * produces is the first caller with three, and the alternative was folding
   * them into `sub`, which is one line and ellipsised.
   */
  meta?: ReactNode
  onward?: boolean
  /**
   * Drawn, and not pressable yet. The same word `Button` and `Choice` use for
   * the same thing, faded the same amount: a row that is present and
   * unchoosable is not the same as one that is absent, and a list that empties
   * itself while somebody is reading it is worse than one that dims.
   */
  off?: boolean
  /** What the row says for anybody who cannot see it, where the words on it are not enough. */
  label?: string
  onPress?: () => void
}) {
  return (
    <button
      type="button"
      className="wf-row"
      role="listitem"
      disabled={off}
      aria-label={label}
      onClick={onPress}
    >
      <span className={`wf-row__thumb wf-spine--${cloth ?? 'wood'}`} aria-hidden="true">
        {photo && <img className="wf-row__photo" src={photo} alt="" loading="lazy" decoding="async" />}
      </span>
      <span className="wf-row__text">
        <span className="wf-row__title">{title}</span>
        {sub && <span className="wf-row__sub">{sub}</span>}
      </span>
      <span className="wf-row__meta">
        {place && <span className="wf-row__place">{place}</span>}
        {/* A word arrives as a word and is boxed here, the way it always was.
            Anything else is already the spans it wants to be, and wrapping
            them would make three lines one. */}
        {typeof meta === 'string' ? <span>{meta}</span> : meta}
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
 * ## And since #410 he lies down and sleeps through it
 *
 * > I'd like the actions that we have available to be scooted down, and then
 * > the cat laying down sleeping with its tail going behind those buttons, and
 * > the tail slightly moving, and the cat's eyes sometimes slowly opening a
 * > little bit and then closing.
 *
 * `lying` is the pose that does that, and it is the pose the first screen uses
 * now. It brings the scoot with it, because the scoot exists for him: the
 * counts take a bottom margin and the doors move down by exactly that, which
 * is the one thing #410 asks of the row below and it says nothing about what a
 * door is.
 *
 * **Round eight's distinction survives it, drawn differently.** He was sitting
 * on an ordinary day and asleep when the collection was empty, so a wall of
 * zeros read as a new collection rather than a broken one at no cost in words.
 * `lying` takes the ordinary day, and the empty one keeps `sleeping`: a
 * collection with nothing in it draws no doors, and a tail reaching behind
 * buttons that are not there is a tail hanging in mid-air. So the two days are
 * still two drawings, and the pose that says a screen has something on it is
 * now the stretched-out one rather than the upright one.
 */
const CAT_ON_STATS: Record<'sitting' | 'sleeping' | 'lying', {
  size: number
  doing?: CatDoing
  /** Whether he is drawn across the row rather than inside its last cell. */
  across?: boolean
}> = {
  sitting: { size: 58 },
  sleeping: { size: 40 },
  lying: { size: 132, doing: 'dozing', across: true },
}

export function Stats({
  items,
  cat,
}: {
  items: { n: string; word: string; onPress?: () => void }[]
  /**
   * The bookend. `lying` is asleep and alive, hanging out of the row with his
   * tail behind whatever is under it, and it is what the first screen draws.
   * `sitting` and `sleeping` are the still pair, inside the last cell.
   */
  cat?: 'sitting' | 'sleeping' | 'lying'
}) {
  const how = cat ? CAT_ON_STATS[cat] : undefined

  return (
    <div className={`wf-stats${how?.across ? ' wf-stats--bed' : ''}`}>
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
      {cat && how && (
        <div className={`wf-stats__cat${how.across ? ' wf-stats__cat--bed' : ''}`}>
          <Cat pose={cat} size={how.size} doing={how.doing} />
        </div>
      )}
    </div>
  )
}
