/**
 * A stop before something that cannot be undone.
 *
 * ## Why this exists on the week thirty-one sentences were deleted
 *
 * #262 took thirty-one sentences off these screens for explaining rather than
 * serving, and this is a component whose whole job is to explain. Both are
 * right, and the line between them is worth having written down here, beside
 * the thing that sits on the wrong side of it if nobody watches:
 *
 * **Ambient prose is noise. An explanation at the moment of an irreversible
 * decision is the entire job.** A caption saying a shelf can be tapped is
 * something a person finds out by tapping. What happens to twenty-four books
 * when an area goes is something they find out afterwards, and afterwards is
 * too late.
 *
 * So nothing here is allowed onto a screen. It is drawn when somebody asks for
 * the irreversible thing, it says what will happen to their own books with the
 * count in it, and it goes away again.
 *
 * ## This is `ConfirmDialog`, and `ConfirmDialog` is gone
 *
 * `src/components/ConfirmDialog.tsx` was the working app's version of this
 * decision, and every decision it made is kept here: the destructive button
 * first and outlined rather than filled, the keep-it button beside it and the
 * one a thumb lands on, the press on the page around the card meaning "keep
 * it", and the pair of them going quiet while the answer is carried out. The
 * file itself went when the book's page was converted (#387), because the two
 * were the same dialog and this paragraph promised there would only ever be
 * one of them. The area screen already asked here; the book's delete asks here
 * now too.
 *
 * ## The three parts, and why the middle one is here at all
 *
 * A title that says what happens to the books, a line or two under it, and a
 * short list of what reads differently afterwards. The last is the argument
 * this component is really making: labels in this app are worked out from
 * where a thing sits, so removing one area renames every area after it, and a
 * sentence claiming that is worth less than four rows showing it.
 */

import type { ReactNode } from 'react'
import { Button } from './Controls'
import { Place } from './List'

export function Sure({
  title,
  said,
  becomes,
  act,
  busy = false,
  onAct,
  onKeep,
}: {
  /** What happens, said about their books and with the count in it. */
  title: string
  /** The rest of what they need before they answer. Two sentences at most. */
  said?: ReactNode
  /** What reads differently afterwards, because a label is worked out. */
  becomes?: { from: string; to: string }[]
  /** The word on the button that does it. Never "OK". */
  act: string
  /**
   * The answer is being carried out right now, so neither button is pressable.
   *
   * No gallery screen sets it, for the reason `Button`'s own `off` says: a
   * wireframe answers "what does this screen offer" and the app answers "and
   * can it be done yet", which is a fact about a request in flight. It arrived
   * with the book's delete, where the write takes photographs off a disk and a
   * second press would send a second delete after the first.
   */
  busy?: boolean
  onAct?: () => void
  onKeep?: () => void
}) {
  return (
    /*
     * Pressing the page around the card is the same answer as "Keep it", which
     * is what `ConfirmDialog` did before this became the one dialog. Only the
     * page itself: a press that started on the card is somebody reading it.
     */
    <div
      className="wf-sure"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => { if (event.target === event.currentTarget) onKeep?.() }}
    >
      <div className="wf-sure__card">
        <h2 className="wf-sure__title">{title}</h2>
        {said && <p className="wf-sure__said">{said}</p>}

        {becomes && becomes.length > 0 && (
          <div className="wf-sure__becomes">
            <span className="wf-sure__lead">What reads differently afterwards</span>
            {becomes.map((one) => (
              <span className="wf-sure__row" key={one.from}>
                <Place quiet>{one.from}</Place>
                <span className="wf-sure__word">becomes</span>
                <Place quiet>{one.to}</Place>
              </span>
            ))}
          </div>
        )}

        {/* Destructive first, keep-it second, exactly as `ConfirmDialog` has
            it. The one a thumb finds without aiming is the one that changes
            nothing, and the red one is outlined rather than filled: a filled
            red button invites the press it is warning about. */}
        <div className="wf-sure__acts">
          <Button tone="danger" off={busy} onPress={onAct}>
            {act}
          </Button>
          <Button tone="secondary" off={busy} onPress={onKeep}>
            Keep it
          </Button>
        </div>
      </div>
    </div>
  )
}
