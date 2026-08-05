/**
 * Putting down a capture that was picked up from the queue.
 *
 * Opening one claims it, and a claim is a five minute lease: while it is held
 * the queue tells everybody else the book is "being worked on by alex". So
 * walking away has to hand it back, and walking away has far more shapes than
 * the one button that used to do it. Leaving by the header nav sent nothing at
 * all, and the browser's own back button, the tab closing and the phone
 * putting the page away were handled nowhere (#150). For five minutes
 * afterwards the next person is told a book is being worked on by somebody
 * who has gone, which in a session where two people are moving through a
 * stack is a real stall.
 *
 * ## What happens to the typing
 *
 * It is written down, and that is not the same as saving it. A queued capture
 * already takes what somebody types as they type it: `edit_json` is the
 * overlay a handoff is made of (#65), it is what the next person opens the
 * book to, and it is deliberately not the catalogue. Nothing here writes a
 * book. Confirming is still "Looks right, shelve it" and nothing else, and a
 * capture nobody confirms stays a capture.
 *
 * The autosave is a trailing debounce, so what it has not sent yet is
 * everything typed since the person last paused, which on the way out is
 * usually the whole title and the whole note. Dropping that is what made the
 * work "vanish silently". Sending it finishes a write the app had already
 * begun rather than starting a new kind of one.
 *
 * The alternative was to warn before leaving. Rejected on three counts: a
 * confirmation on every exit is one you learn to dismiss without reading,
 * which is the reasoning that inverted the discard in #120; no dialog can be
 * shown at all for a tab that is closing or a page the phone has put away, so
 * it would answer the taps and leave the three worst routes unanswered; and
 * it would ask somebody to reconfirm work that had already been written down
 * a second earlier by the autosave they never see.
 *
 * ## Why one request and not two
 *
 * The edit and the release travel together, as one PATCH. An edit needs the
 * claim, so it has to come first, and a page that is going away cannot be
 * relied on to run the second half of anything: `keepalive` guarantees a
 * request is sent, not that a promise callback ever runs. Firing both at once
 * instead only trades that for a race, since an edit that lands after a
 * release takes the claim straight back. One request has no order to get
 * wrong, and the server releases whether or not it accepts the edit.
 *
 * ## Which "the page is going away" event
 *
 * `pagehide`, and only that. It is the one event that fires for all three
 * ways out that are not a tap: the browser's back button leaving the app, the
 * tab closing, and the page being frozen when the phone puts the browser
 * away. `visibilitychange` is deliberately not used, because it also fires
 * when somebody glances at a notification and comes straight back, and
 * releasing there would take the book out of their hands mid-sentence. A page
 * the operating system kills outright fires nothing at all, and the five
 * minute lease is the backstop for exactly that.
 */

import { api, type CaptureEdit } from './api'

/** A capture in somebody's hands, with whatever they typed that is unsent. */
export interface HeldCapture {
  id: number
  who: string
  /**
   * The difference between the capture as the server holds it and the draft
   * on screen. An empty one is meaningful and still worth sending: it records
   * that a person read this book and left it as it was, which the queue needs
   * in order to tell that apart from a book nobody has opened.
   */
  edit: CaptureEdit
}

/**
 * Put the book down: write what was typed, and let the claim go.
 *
 * Never rejects. Every caller is already on their way out of the screen, and
 * there is nowhere left to show them an error about a book they have left.
 *
 * @param keepalive true when the page itself is going away, which asks the
 *   browser to send the request even though the page that made it will not be
 *   there to read the answer.
 */
export function putDownCapture(held: HeldCapture, keepalive = false): Promise<void> {
  return api.updateCapture(held.id, held.who, held.edit, { release: true, keepalive })
    .then(() => {}, () => {})
}

/**
 * Put down whatever is being held when the page goes away, and hand back the
 * teardown so a component can register this once and drop it on unmount.
 *
 * `heldNow` is asked at the moment of leaving rather than handed a value,
 * because the listener is registered once and what is in somebody's hands
 * changes all afternoon.
 */
export function putDownOnPageHide(
  heldNow: () => HeldCapture | null,
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const leave = () => {
    const held = heldNow()
    if (held) void putDownCapture(held, true)
  }
  target.addEventListener('pagehide', leave)
  return () => target.removeEventListener('pagehide', leave)
}
