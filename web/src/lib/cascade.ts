import type { PlacementStrip } from './api'

/**
 * The stack of books a full plank leaves somebody holding.
 *
 * Saying a plank is full takes its last book off and sends it to the plank
 * after it. Whether it fits there is not computable, because capacity is not
 * modelled and never will be (`docs/shelving.md`, decision 2): books are
 * different thicknesses, so a thin paperback coming off the end does not
 * necessarily open room for the hardback going in. Only the person standing
 * at the shelf can say.
 *
 * That makes every rung a question in its own right, on the way down AND on
 * the way back up. #80 settled the whole chain on one yes at the deepest
 * point, reasoning that each rung above was only waiting for room below. True
 * of an abstract slot model, false of physical books, and #110 is the owner
 * reporting it from the room: placing the fourth book took them straight back
 * to the first, past two moves nobody had looked at.
 *
 * So it is a stack, and it unwinds one frame at a time. A yes pops one frame
 * and hands the question to the frame under it. A no on the way out pushes a
 * fresh frame exactly the way the first no did, because it is the same
 * physical event and two code paths for it would drift apart.
 *
 * Three things are kept apart here that this flow used to run together:
 *
 *   asking    a frame on the stack. A question, nothing more.
 *   applying  what a yes does to the shelves, one frame at a time (#111).
 *   recording where a book physically ended up, written as it is confirmed.
 *
 * Which is why a frame carries a *proposal* rather than a fact. The proposal
 * is re-read from the server whenever the frame becomes the question again,
 * because moves made deeper down have changed the plank it is about, and an
 * answer given against a picture that predates the last move is #106.
 */

/** The plank somebody said would not take another book. */
export interface Frame {
  /** The plank that is full, which is the argument the server is asked with. */
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
  /** The plank it goes on. */
  to: string
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
   * The book being placed moved on, rather than a shelved one being displaced.
   *
   * Nothing to confirm and nothing to record: the book is still in your hand,
   * and where it lands is written when it is saved. So it never joins the
   * stack. It is listed anyway, because a screen that silently renamed the
   * plank in the question reads as a tap that did nothing.
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

/**
 * A plank said to be full, with the move that would open it. The only way a
 * frame is ever made, whether the no came from the book in hand or from a
 * frame being asked again on the way out.
 */
export function pushFrame(cascade: Cascade, frame: Frame): Cascade {
  return { done: cascade.done, stack: [...cascade.stack, frame] }
}

/**
 * The book in hand went on to the next plank instead, and nothing already
 * shelved moved (#77). Done the moment it is asked for: there is no question
 * to put to anybody, because the book never left their hand.
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
 * off the stack.
 *
 * Exactly one frame. The question then belongs to whatever is under it, which
 * is a book that was moved earlier and has not been asked about since the
 * plank it is going on changed. Only when nothing is left does the question go
 * back to the book in hand.
 */
export function confirm(cascade: Cascade, done: Done): Cascade {
  return { done: [...cascade.done, done], stack: cascade.stack.slice(0, -1) }
}

/**
 * The frame that has just become the question again, re-read from the shelves.
 *
 * Its proposal was drawn before the moves underneath it were made, so the
 * plank in the picture has lost a book since. Replacing it is the #106 rule
 * one level in: never answer against an arrangement that predates the last
 * move.
 */
export function repropose(cascade: Cascade, proposal: Proposal): Cascade {
  const top = asking(cascade)
  if (!top) return cascade
  return {
    done: cascade.done,
    stack: [...cascade.stack.slice(0, -1), { ...top, proposal }],
  }
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
 * Where you are, said out loud.
 *
 * Four planks deep with a re-descent in it is disorienting, and the sentence
 * on screen otherwise names two planks and leaves you to work out how many
 * books are still stacked up behind the one in your hands. So it says which
 * book is being placed, how far in that is, and what is still to come.
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

/** The planks this shuffle has touched, in the order it touched them. */
export function spreadOf(cascade: Cascade): string[] {
  const planks = [
    ...cascade.done.flatMap((step) => [step.from, step.to]),
    ...cascade.stack.flatMap((frame) => [frame.from, frame.proposal.to]),
  ]
  return [...new Set(planks)]
}
