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

import {
  useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
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
  /*
   * A head with nowhere to go is not a button.
   *
   * The piece's own screen draws this at the top of itself, and so does the
   * screen for cutting an area into it: there is no "go to the piece" from a
   * screen already about the piece. Drawn as a button with an arrow on it, it
   * is a target that does nothing, which is worse than not being a target.
   */
  const inside = (
    <>
      <span className="wf-nest__line">
        <span className="wf-nest__name">{name}</span>
        {note && <span className="wf-nest__note">{note}</span>}
        {onPress && <IconOnward size={18} />}
      </span>
      {holds && <span className="wf-nest__holds">{holds}</span>}
    </>
  )

  return (
    <section className="wf-nest" aria-label={name}>
      {onPress
        ? (
          <button type="button" className="wf-nest__head" onClick={onPress}>
            {inside}
          </button>
        )
        : <div className="wf-nest__head">{inside}</div>}
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
        {/* "1 books" is what a wireframe never shows you, because every count
            in one was chosen. A real area holds one book often enough. */}
        <span className="wf-box__count">{books} {books === 1 ? 'book' : 'books'}</span>
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
export function Order({
  slots,
  places,
  onReorder,
}: {
  slots: { label: string; name: string; on?: boolean }[]
  /**
   * What each place down the column is called, which does **not** travel with
   * the piece standing in it.
   *
   * The column is a set of numbered places and a piece is dragged into one, so
   * the numbers stay put and the names move through them. Left out, each piece
   * carries its own label, which is right for a column nobody can drag.
   */
  places?: string[]
  /**
   * Given one, the column can be dragged: it is called with the order the
   * pieces are in once a finger comes off, as indices into what was handed in.
   *
   * Without it the column is a drawing, which is what the gallery wants and
   * what a still picture can honestly show. See the note about the lift and the
   * gap: those are felt rather than seen, and they live in here.
   */
  onReorder?: (order: number[]) => void
}) {
  /*
   * While a finger is down: which row was taken hold of, where the rows were
   * when it went down, and how far it has travelled.
   *
   * The rects are measured once, at the moment of the press, and not again.
   * Measuring during the move would be measuring the rows as they shuffle,
   * which is a feedback loop: the row you are dragging moves, so the next
   * measurement says it is somewhere else, so it moves again.
   */
  const [carried, setCarried] = useState<{
    from: number
    at: number
    y: number
    dy: number
    pitch: number
  } | null>(null)
  const column = useRef<HTMLDivElement>(null)

  /** The order as it reads under the finger right now. */
  const order = carried
    ? moveWithin(slots.map((_, at) => at), carried.from, carried.at)
    : slots.map((_, at) => at)

  const take = (at: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onReorder) return
    const rows = [...(column.current?.children ?? [])] as HTMLElement[]
    const tops = rows.map((row) => row.getBoundingClientRect().top)
    // Equal rows, so one gap does for all of them. One row cannot be dragged
    // anywhere, and a pitch of zero would divide by nothing below.
    const pitch = tops.length > 1 ? tops[1]! - tops[0]! : 0
    event.currentTarget.setPointerCapture(event.pointerId)
    setCarried({ from: at, at, y: event.clientY, dy: 0, pitch })
  }

  const drag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    setCarried((held) => {
      if (!held || !held.pitch) return held
      const dy = event.clientY - held.y
      const wanted = Math.max(
        0,
        Math.min(slots.length - 1, held.from + Math.round(dy / held.pitch)),
      )
      return { ...held, dy, at: wanted }
    })
  }

  const drop = () => {
    setCarried((held) => {
      if (held && held.at !== held.from) {
        onReorder?.(moveWithin(slots.map((_, at) => at), held.from, held.at))
      }
      return null
    })
  }

  /**
   * The same move without a finger.
   *
   * Every row is already a button, so it already takes focus and already has a
   * keyboard on it; up and down are what somebody would try. It is not an
   * alternative anybody was asked for, it is the thing that stops a drag being
   * the only way to say a piece stands somewhere else.
   */
  const key = (at: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!onReorder) return
    const to = event.key === 'ArrowUp' ? at - 1 : event.key === 'ArrowDown' ? at + 1 : null
    if (to === null || to < 0 || to >= slots.length) return
    event.preventDefault()
    onReorder(moveWithin(slots.map((_, index) => index), at, to))
  }

  return (
    <div
      className={`wf-order${onReorder ? ' wf-order--live' : ''}`}
      aria-label="Where it stands"
      ref={column}
    >
      {order.map((which, at) => {
        const slot = slots[which]!
        const lifted = carried !== null && which === carried.from
        return (
          <button
            /*
             * Where it sits in what was handed in, and not its label: the
             * owner has two pieces both standing at 4, so a label is not a
             * name for one row. This one is unique, and it is stable while the
             * display order changes under a finger, which is what lets React
             * carry the row it is already drawing rather than redraw it.
             */
            key={which}
            type="button"
            className={[
              'wf-order__slot',
              slot.on ? 'wf-order__slot--on' : '',
              lifted ? 'wf-order__slot--carried' : '',
            ].filter(Boolean).join(' ')}
            aria-pressed={slot.on || undefined}
            style={lifted
              ? { transform: `translateY(${carried.dy - (carried.at - carried.from) * carried.pitch}px)` }
              : undefined}
            onPointerDown={(event) => take(at, event)}
            onPointerMove={carried ? drag : undefined}
            onPointerUp={carried ? drop : undefined}
            onPointerCancel={carried ? drop : undefined}
            onKeyDown={(event) => key(at, event)}
          >
            <span className="wf-order__n">{places?.[at] ?? slot.label}</span>
            <span className="wf-order__name">{slot.name}</span>
            <span className="wf-order__grip" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

/**
 * One entry carried to another place in the same list.
 *
 * The whole of what a drag does to the model, exported so it can be checked
 * without a browser: everything else about the gesture is rects and pointer
 * ids, and this is the part that can be wrong in a way nobody sees.
 */
export function moveWithin<T>(items: readonly T[], from: number, to: number): T[] {
  const rest = [...items]
  const [one] = rest.splice(from, 1)
  rest.splice(to, 0, one!)
  return rest
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
