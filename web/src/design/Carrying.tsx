/**
 * The parts of the job where somebody walks across a room with books in their
 * arms.
 *
 * ## The unit of work is a trip, and a trip is two places
 *
 * A rule change can displace fifty books. A list of fifty books, in book
 * order, is a list of fifty walks: you read a title, find it, carry it, come
 * back, read the next one. What a person actually does is stand at one area,
 * take everything off it that is going to one other area, walk once, and put
 * them down.
 *
 * So the unit here is neither the book nor the area: it is **the pair**,
 * everything coming off `4A` that is going onto `3A`. That is exactly the group
 * `domain/placement/plan.ts` already answers with, which is not a coincidence:
 * the model was already grouping the answer the way the body wants to do the
 * work, and this draws it rather than re-deriving it.
 *
 * ## The two ends are two labels and the word "to"
 *
 * Never an arrow. Every arrow in Unicode lives in the block this design system
 * refuses outright, and the refusal is checked, so the word is not a fallback
 * for a glyph that would not render: it is the only spelling there is. It also
 * reads aloud, which a glyph between two labels does not.
 */

import type { ReactNode } from 'react'
import { IconOnward } from './Icons'
import { Place } from './List'

/** However many books, said the way somebody would say it. */
const books = (n: number) => (n === 1 ? '1 book' : `${n} books`)

/**
 * One trip: everything leaving one area for one other, as a target.
 *
 * The note is the stretch of authors it covers, because that is what somebody
 * reads off the spines while pulling books, and it is the one line that turns
 * "eight books" into something you can act on without opening it.
 */
export function Trip({
  from,
  to,
  count,
  note,
  onPress,
}: {
  /** Where the books are now, as the label reads off the furniture. */
  from: string
  /** Where they are going. */
  to: string
  count: number
  /** Whatever this trip needs said in words: the stretch, or what is done. */
  note?: string
  onPress?: () => void
}) {
  return (
    <button
      type="button"
      className="wf-trip"
      role="listitem"
      aria-label={`${count === 1 ? 'One book' : `${count} books`}, ${from} to ${to}`}
      onClick={onPress}
    >
      <span className="wf-trip__line">
        <span className="wf-move">
          <Place>{from}</Place>
          <span className="wf-move__to">to</span>
          <Place>{to}</Place>
        </span>
        <span className="wf-trip__count">{books(count)}</span>
        <IconOnward size={18} />
      </span>
      {note && <span className="wf-trip__note">{note}</span>}
    </button>
  )
}

/**
 * The trips, in the order somebody would walk them.
 *
 * **Ordered by where the books come off, not by where they are going**, and
 * that decides the shape of the whole screen. Taking a book off an area means
 * finding it among the ones that are staying, which is reading spines; putting
 * one down does not. So a person should read an area once and pull everything
 * that is leaving it, and the list that makes that natural is the one that puts
 * every trip off `4A` together.
 *
 * Grouping the other way costs the same number of walks and more reading: a
 * destination fed by three areas is three separate hunts before one delivery.
 */
export function Trips({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="wf-trips" role="list" aria-label={label}>
      {children}
    </div>
  )
}
