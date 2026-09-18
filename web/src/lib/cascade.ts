import type { PlacementStrip } from './api'

/**
 * The stack of books a full plank leaves somebody holding.
 *
 * Saying a plank is full takes its last book off and sends it to the plank
 * after it. Whether it fits there is not computable, since capacity is not
 * modelled: only the person standing at the shelf can say. See
 * `docs/shelving.md`, decision 2.
 *
 * So it is a stack, unwound one frame at a time: a yes pops one frame and
 * hands the question to the frame under it, and a no on the way out pushes a
 * fresh frame exactly the way the first no did.
 *
 * Three things are kept apart:
 *
 *   asking    a frame on the stack, a question and nothing more.
 *   applying  what a yes does to the shelves, one frame at a time.
 *   recording where a book physically ended up, written as it is confirmed.
 *
 * A frame carries a proposal rather than a fact, and the proposal is re-read
 * from the server whenever the frame becomes the question again, since moves
 * made deeper down may have changed the plank it is about.
 */

/** The plank somebody said would not take another book. */
export interface Frame {
  /**
   * The plank that is full, which is what the server is asked about. The
   * id, not the label: a label is a rendering and changes the moment
   * somebody names the bookcase. `from` is that same plank said for a
   * person.
   */
  fromAreaId: number
  from: string
  /** Whether a plank that has to be made would be a new area or a new bookcase. */
  kind: 'shelf' | 'area'
  /** What moving off `from` would mean, as the shelves stand right now. */
  proposal: Proposal
}

/** One move, offered. Nothing about it is true until somebody confirms it. */
export interface Proposal {
  /** The displaced book, so where it lands can be recorded. */
  id: number
  title: string
  /** Written down the spine hanging under the gap. */
  authorFiling: string
  /** The plank it goes on, as the person reads it. */
  to: string
  /**
   * That same plank, said as the plank. Null while the plank is one the
   * proposal would make; a frame is asked again against the shelves before
   * it is confirmed, by which point the plank exists.
   */
  toAreaId: number | null
  /** That plank drawn, with the gap where the book goes. */
  strip: PlacementStrip | null
}

/** A move that actually happened, because somebody said they made it. */
export interface Done {
  id: number
  title: string
  from: string
  to: string
  /**
   * The book being placed moved on, rather than a shelved one being
   * displaced. Nothing to confirm and nothing to record, so it never joins
   * the stack; it is listed anyway, since a screen that silently renamed
   * the plank in the question would read as a tap that did nothing.
   */
  inHand?: boolean
}

export interface Cascade {
  /**
   * Moves somebody has confirmed making, oldest first. Append only: a book
   * that was physically carried was physically carried, and abandoning a deep
   * chain does not un-carry it.
   */
  done: Done[]
  /** Questions still open, outermost first. The last one is on screen. */
  stack: Frame[]
}

export const emptyCascade: Cascade = { done: [], stack: [] }

/** A plank said to be full, with the move that would open it. */
export function pushFrame(cascade: Cascade, frame: Frame): Cascade {
  return { done: cascade.done, stack: [...cascade.stack, frame] }
}

/**
 * The book in hand went on to the next plank instead, and nothing already
 * shelved moved. Done the moment it is asked for: there is no question to
 * put to anybody, since the book never left their hand.
 */
export function pushCarry(cascade: Cascade, done: Omit<Done, 'inHand'>): Cascade {
  return { done: [...cascade.done, { ...done, inHand: true }], stack: cascade.stack }
}

/** The frame awaiting an answer, or null when the question is about the book. */
export function asking(cascade: Cascade): Frame | null {
  return cascade.stack[cascade.stack.length - 1] ?? null
}

/**
 * The person says that one fitted, so it joins what has happened and comes
 * off the stack. The question then belongs to whatever is under it; only
 * when nothing is left does it go back to the book in hand.
 */
export function confirm(cascade: Cascade, done: Done): Cascade {
  return { done: [...cascade.done, done], stack: cascade.stack.slice(0, -1) }
}

/**
 * The frame that has just become the question again, re-read from the
 * shelves: its proposal was drawn before the moves underneath it were made,
 * so the plank in the picture may have lost a book since.
 */
export function repropose(cascade: Cascade, proposal: Proposal): Cascade {
  const top = asking(cascade)
  if (!top) return cascade
  return {
    done: cascade.done,
    stack: [...cascade.stack.slice(0, -1), { ...top, proposal }],
  }
}

/**
 * The shuffle as it stands after somebody leaves the shelving step. `done`
 * survives; only the open questions are dropped, since a frame is a
 * proposal and nothing on the shelves has moved for it.
 *
 * Returns the same cascade when there was nothing open, so a route change
 * with no shuffle to tidy costs no render.
 */
export function walkedAway(cascade: Cascade): Cascade {
  return cascade.stack.length ? { done: cascade.done, stack: [] } : cascade
}

/** How many books are in the air. Zero means only the one in your hand. */
export function depth(cascade: Cascade): number {
  return cascade.stack.length
}

/** Whether anything has happened yet, which changes how the question reads. */
export function started(cascade: Cascade): boolean {
  return cascade.done.length > 0 || cascade.stack.length > 0
}

/**
 * Where you are, said out loud: which book is being placed, how far in that
 * is, and what is still to come.
 */
export function whereYouAre(cascade: Cascade, inHand: string): string {
  const frame = asking(cascade)
  if (!frame) return ''

  const above = cascade.stack.length - 1
  const deep = `${cascade.stack.length} ${cascade.stack.length === 1 ? 'book' : 'books'} deep`

  if (above === 0) {
    return `Placing ${frame.proposal.title}, ${deep}. Then back to ${inHand}.`
  }

  return `Placing ${frame.proposal.title}, ${deep}. ` +
    `${above} ${above === 1 ? 'book' : 'books'} to check again after this, ` +
    `then ${inHand}.`
}
