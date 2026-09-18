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
  /** A word instead of a place: "Checked out", "Needs an ISBN". Takes nodes rather than a string since a row can have more than one at its end. */
  meta?: ReactNode
  onward?: boolean
  /** Drawn, and not pressable yet. A row that is present and unchoosable is not the same as one that is absent. */
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
        {typeof meta === 'string' ? <span>{meta}</span> : meta}
        {onward && !place && !meta && <IconOnward size={18} />}
      </span>
    </button>
  )
}

/**
 * A word, boxed. There is no tint for a particular tag: the one tone left
 * (`on`) says a tag is doing something right now, a fact about the screen
 * rather than about the tag, and `wants` is the same kind of fact for a book
 * that needs a person. Nothing is ever told by the tint alone: every one of
 * these carries its word, which `design.test.tsx` checks. Given an `onPress`
 * it becomes a target rather than a label.
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

/** A row of them, wrapping. A span rather than a div: a queue row is a single button, and a div inside a button is not phrasing content. */
export function Tags({ children }: { children: ReactNode }) {
  return <span className="wf-tags">{children}</span>
}

/** A plank label, set the way it reads off the shelf edge. */
export function Place({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <span className={`wf-place${quiet ? ' wf-place--quiet' : ''}`}>{children}</span>
}

/**
 * The counts, three across and wrapping. A count with an `onPress` is a
 * target rather than a label: a metric nobody can act on is decoration. Its
 * accessible name is the number and the word together.
 *
 * Three across, wrapping rather than a fixed grid, so a count the catalogue
 * has not answered yet leaves the others sharing the width instead of a hole.
 *
 * The cat here is only ever the bookend (`sitting` or `sleeping`), never the
 * animated `lying` pose: that one lies on the doors instead, drawn by `Doors`
 * in `Controls.tsx`. He is drawn here rather than handed in so the gallery
 * and the app cannot end up with two cats at two sizes.
 */
const CAT_ON_STATS: Record<'sitting' | 'sleeping', { size: number }> = {
  sitting: { size: 58 },
  sleeping: { size: 40 },
}

export function Stats({
  items,
  cat,
}: {
  items: { n: string; word: string; onPress?: () => void }[]
  /** The bookend, in the cell after the last count. `sitting` on an ordinary run of numbers, `sleeping` where there is nothing at all. */
  cat?: 'sitting' | 'sleeping'
}) {
  const how = cat ? CAT_ON_STATS[cat] : undefined

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
      {cat && how && (
        <div className="wf-stats__cat">
          <Cat pose={cat} size={how.size} />
        </div>
      )}
    </div>
  )
}
