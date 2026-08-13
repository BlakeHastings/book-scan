/**
 * The furniture, drawn as boxes inside boxes.
 *
 * **These screens deliberately do not draw the carpentry.** The library draws
 * a real board with real spines standing on it, because there the point is to
 * find a book in the room. Here the point is to say how the collection is
 * organised, and a drawing of a bookcase would promise that the app knows
 * which areas sit on which board and how tall the piece is. It knows none of
 * that and it does not need to: a piece, the areas under it, and a way to add
 * another is the whole shape.
 *
 * That is the owner's call on #251 and it settled an open question rather than
 * dodging one. An earlier pass drew each piece as an elevation, which needed a
 * fact the model does not hold, namely which two areas share one board. Boxes
 * need nothing the model does not already have, so nothing was added to it.
 *
 * **A label is never typed.** What a box says it reads as is what a read of the
 * furniture already answers, from the position and the two names. There is no
 * field for it anywhere and there must not be one.
 */

import type { ReactNode } from 'react'
import { IconOnward } from './Icons'

/**
 * A piece, and whatever is nested under it.
 *
 * The head is the piece itself and it is a target of its own, because a rule
 * can be about a whole bookcase as easily as about one area, and that is how a
 * stretch of books that spans furniture gets said.
 */
export function Nest({
  name,
  note,
  holds,
  onPress,
  children,
}: {
  /** What it is called, or what it is called when it is called nothing. */
  name: string
  /** Counts, usually. Whatever the head needs said in words. */
  note?: string
  /** What its own rule sends here, if it has one. Said the way a person would. */
  holds?: string
  onPress?: () => void
  /** The areas under it, and the way to add another. */
  children: ReactNode
}) {
  return (
    <section className="wf-nest" aria-label={name}>
      <button type="button" className="wf-nest__head" onClick={onPress}>
        <span className="wf-nest__line">
          <span className="wf-nest__name">{name}</span>
          {note && <span className="wf-nest__note">{note}</span>}
          <IconOnward size={18} />
        </span>
        {holds && <span className="wf-nest__holds">{holds}</span>}
      </button>
      <div className="wf-nest__body">{children}</div>
    </section>
  )
}

/**
 * One area, as a box under the piece it belongs to.
 *
 * Three things and no more: what it reads as, how much is in it, and what it
 * holds. The last one is the rule in a person's words, and it is here rather
 * than a screen deeper because "what belongs where" is the question the whole
 * of this is for.
 */
export function AreaBox({
  reads,
  books,
  holds,
  on = false,
  onPress,
}: {
  /** The label, as a read of the furniture already answers it. */
  reads: string
  books: number
  /** What the rule sends here, said the way somebody would say it. */
  holds?: string
  /** The one being worked on. */
  on?: boolean
  onPress?: () => void
}) {
  return (
    <button
      type="button"
      className={`wf-box${on ? ' wf-box--on' : ''}`}
      aria-pressed={on || undefined}
      onClick={onPress}
    >
      <span className="wf-box__head">
        <span className="wf-box__reads">{reads}</span>
        <span className="wf-box__count">{books} books</span>
      </span>
      {holds && <span className="wf-box__holds">{holds}</span>}
    </button>
  )
}

/** The way to add another one, at the end of the things there already are. */
export function AddBox({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <button type="button" className="wf-add" onClick={onPress}>
      {children}
    </button>
  )
}

/**
 * Where a piece stands, and what standing there is called.
 *
 * Not a number in a field, because the number is not the fact: the fact is
 * that this one is second of four, and moving it changes what every area on it
 * reads as, and what every area reads as on whatever it passes.
 *
 * **You move it by moving it.** There were two buttons under this, "move it
 * earlier" and "move it later", and the owner asked for the piece itself to be
 * the thing you take hold of. So every piece is a row with a grip on it, and
 * the row is the target rather than a button beside it.
 *
 * **It is a column because a row wraps.** He warned about that in the same
 * breath: five pieces with names like "By the window" do not fit across a
 * phone, and a strip that wraps is a drag with two axes in it and a gap that
 * opens on a line above. A column cannot wrap, every target is the full width,
 * and the whole list is visible at once at the sizes a room has.
 *
 * **What a still picture cannot settle**: the lift, the gap opening under the
 * finger, whether the list scrolls when you drag past the end. Those are felt
 * rather than seen, and this draws only what they rest on either side of.
 */
export function Order({ slots }: { slots: { label: string; name: string; on?: boolean }[] }) {
  return (
    <div className="wf-order" aria-label="Where it stands">
      {slots.map((slot) => (
        <button
          key={slot.label}
          type="button"
          className={`wf-order__slot${slot.on ? ' wf-order__slot--on' : ''}`}
          aria-pressed={slot.on || undefined}
        >
          <span className="wf-order__n">{slot.label}</span>
          <span className="wf-order__name">{slot.name}</span>
          <span className="wf-order__grip" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/**
 * One line of a rule: a thing that has to be true of a book.
 *
 * Every line has to hold, and there is no way to say "or". Two ways of saying
 * a thing are two rules, which is what makes a rule readable at the moment
 * somebody is trying to work out why a book landed where it did.
 */
export function Must({
  join,
  lead,
  tag,
  onPress,
}: {
  /** The word before this line when it is not the first. Always "and". */
  join?: string
  /** What is being asked, in words: "Tagged", "Tagged anything under". */
  lead: string
  /** The answer, which is a tag as a person reads it and never a code. */
  tag: string
  onPress?: () => void
}) {
  return (
    <>
      {join && <span className="wf-must__join">{join}</span>}
      <button type="button" className="wf-must" onClick={onPress}>
        <span className="wf-must__lead">{lead}</span>
        <span className="wf-tag">{tag}</span>
      </button>
    </>
  )
}

export function Musts({ children }: { children: ReactNode }) {
  return <div className="wf-musts">{children}</div>
}

/**
 * A rule that wanted a book, and whether it got it.
 *
 * The losers are the point. A book that lands somewhere surprising is the
 * moment the whole idea either explains itself or turns into magic, and the
 * explanation is always the same two sentences: which rules asked for it, and
 * why this one beat that one.
 */
export function Claim({
  name,
  about,
  won = false,
  why,
  onPress,
}: {
  name: string
  /** The place the rule points at, as a person reads it. */
  about: string
  won?: boolean
  /** Why it won, or why it did not. */
  why: string
  onPress?: () => void
}) {
  return (
    <button
      type="button"
      className={`wf-claim${won ? ' wf-claim--won' : ''}`}
      onClick={onPress}
    >
      <span className="wf-claim__head">
        <span className="wf-claim__name">{name}</span>
        <span className="wf-claim__mark">{won ? 'Claimed it' : 'Not this one'}</span>
      </span>
      <span className="wf-claim__about">{about}</span>
      <span className="wf-claim__why">{why}</span>
    </button>
  )
}
