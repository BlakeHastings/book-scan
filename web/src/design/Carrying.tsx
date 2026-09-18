/**
 * The parts of the job where somebody walks across a room with books in their
 * arms. The unit of work is a trip, everything coming off one area that is
 * going onto one other, matching the group `domain/placement/plan.ts` already
 * answers with. The two ends are two labels and the word "to", never an
 * arrow: every arrow glyph lives in the Unicode block this design system
 * refuses outright.
 */

import type { ReactNode } from 'react'
import { IconOnward } from './Icons'
import { Place } from './List'

/** However many books, said the way somebody would say it. */
const books = (n: number) => (n === 1 ? '1 book' : `${n} books`)

/** One trip: everything leaving one area for one other, as a target. */
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
 * The trips, in the order somebody would walk them. Ordered by where the
 * books come off, not by where they are going: taking a book off an area
 * means reading spines to find it, so every trip off one area is grouped
 * together rather than by destination.
 */
export function Trips({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="wf-trips" role="list" aria-label={label}>
      {children}
    </div>
  )
}
