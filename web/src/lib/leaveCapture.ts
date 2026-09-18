/**
 * Putting down a capture that was picked up from the queue.
 *
 * Opening one claims it, and a claim is a five minute lease: while it is
 * held the queue tells everybody else the book is "being worked on by
 * alex". Walking away has more shapes than one button can cover: the
 * browser's back button, the tab closing, and the phone putting the page
 * away all have to release it too, or the next person is told for five
 * minutes that somebody who has gone is still working on it.
 *
 * Writing what was typed is not the same as saving it: `edit_json` is the
 * overlay a handoff is made of, and it is deliberately not the catalogue.
 * Nothing here writes a book; confirming is still "Looks right, shelve it".
 *
 * The autosave is a trailing debounce, so what it has not sent yet is
 * everything typed since the person last paused. Sending it on the way out
 * finishes a write the app had already begun, rather than starting a new
 * kind of one.
 *
 * The edit and the release travel together, as one PATCH, rather than two
 * requests: an edit needs the claim, so it has to come first, and a page
 * that is going away cannot be relied on to run a second request at all.
 * The server releases whether or not it accepts the edit.
 *
 * The event is `pagehide`, and only that: it is the one event that fires
 * for all three non-tap ways out (back button, tab closing, page frozen).
 * `visibilitychange` is deliberately not used, since it also fires when
 * somebody glances at a notification and comes straight back, which would
 * take the book out of their hands mid-sentence. A page the operating
 * system kills outright fires nothing at all; the five minute lease is the
 * backstop for that.
 */

import { api, type CaptureEdit } from './api'

/** A capture in somebody's hands, with whatever they typed that is unsent. */
export interface HeldCapture {
  id: number
  who: string
  /**
   * The difference between the capture as the server holds it and the
   * draft on screen. An empty one still records that a person read this
   * book and left it as it was, which the queue needs to tell apart from a
   * book nobody has opened.
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
