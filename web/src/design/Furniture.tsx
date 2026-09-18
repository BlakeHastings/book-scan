/**
 * The furniture, drawn as boxes inside boxes, deliberately not as carpentry:
 * the model does not know which areas share a board or how tall a piece is,
 * so drawing an elevation would promise a fact the app does not have. A
 * label is never typed; it is always read off the position and the two names.
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
  /* A head with nowhere to go is not a button: a target that does nothing is worse than not being a target. */
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
  gone = false,
  on = false,
  onPress,
}: {
  /** The label, as a read of the furniture already answers it. */
  reads: string
  books: number
  /** What the rule sends here, said the way somebody would say it. */
  holds?: string
  /** One somebody took out that books are still standing on: drawn as an outline of something not there, with what is true of it rather than what belongs there. */
  gone?: boolean
  /** The one being worked on. */
  on?: boolean
  onPress?: () => void
}) {
  const said = gone
    ? `Taken out. ${books === 1 ? 'This book is' : 'These books are'} still here `
      + 'until you carry them.'
    : holds

  return (
    <button
      type="button"
      className={`wf-box${gone ? ' wf-box--gone' : ''}${on ? ' wf-box--on' : ''}`}
      aria-pressed={on || undefined}
      onClick={onPress}
    >
      <span className="wf-box__head">
        <span className="wf-box__reads">{reads}</span>
        <span className="wf-box__count">{books} {books === 1 ? 'book' : 'books'}</span>
      </span>
      {said && <span className="wf-box__holds">{said}</span>}
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
 * Where a piece stands, and what standing there is called. Every piece is a
 * row with a grip on it, and the row itself is the drag target rather than
 * buttons beside it. A column rather than a row, since a wrapping strip would
 * be a drag with two axes in it.
 *
 * There is no position number down the side of it: `fixture.position` allows
 * a gap or two pieces sharing a number, per `docs/data-model.md`, so closing
 * gaps to make the column read 1 to 4 would relabel every area on every piece
 * that moved. The order itself is the information instead.
 */
export function Order({
  slots,
  onReorder,
}: {
  slots: { name: string; on?: boolean }[]
  /**
   * Given one, the column can be dragged: it is called with the order the
   * pieces are in once a finger comes off, as indices into what was handed in.
   * Without it the column is a drawing.
   */
  onReorder?: (order: number[]) => void
}) {
  /*
   * While a finger is down: which row was taken hold of, where the rows were
   * when it went down, and how far it has travelled. Rects are measured once,
   * at the press, and not again: measuring during the move would be a
   * feedback loop, since the dragged row itself is what has moved.
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
    /*
     * The press that starts a drag is indistinguishable, to the browser, from
     * the press that starts selecting text. `user-select: none` alone does
     * not reliably stop it on every browser, so `preventDefault` here is what
     * actually does. Touch scrolling is handled separately via `touch-action: none`.
     */
    event.preventDefault()
    const rows = [...(column.current?.children ?? [])] as HTMLElement[]
    const tops = rows.map((row) => row.getBoundingClientRect().top)
    // Equal rows, so one gap does for all of them; a lone row has no pitch to divide by.
    const pitch = tops.length > 1 ? tops[1]! - tops[0]! : 0
    event.currentTarget.setPointerCapture(event.pointerId)
    setCarried({ from: at, at, y: event.clientY, dy: 0, pitch })
  }

  const drag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // Belt and braces alongside the one on `take`.
    event.preventDefault()
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

  /*
   * The finger comes off, and the move is told to whoever owns the order.
   * `carried` is read straight here rather than inside a `setCarried`
   * updater: an updater runs during render (twice in development), which is
   * not a place to call another component's callback from.
   */
  const drop = () => {
    if (carried && carried.at !== carried.from) {
      onReorder?.(moveWithin(slots.map((_, at) => at), carried.from, carried.at))
    }
    setCarried(null)
  }

  /** The same move without a finger: up and down, since every row is already a focusable button. */
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
            /* The index into what was handed in, not what the row says: two pieces can read the same name, so only this is a stable, unique key while the display order changes. */
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
            <span className="wf-order__name">{slot.name}</span>
            <span className="wf-order__grip" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

/**
 * One entry carried to another place in the same list. Exported so this,
 * the whole of what a drag does to the model, can be checked without a browser.
 */
export function moveWithin<T>(items: readonly T[], from: number, to: number): T[] {
  const rest = [...items]
  const [one] = rest.splice(from, 1)
  rest.splice(to, 0, one!)
  return rest
}

/** One line of a rule: a thing that has to be true of a book. Every line in a rule has to hold; there is no "or" within one. */
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

/** A rule that wanted a book, and whether it got it: which rules asked for it, and why this one beat that one. */
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
