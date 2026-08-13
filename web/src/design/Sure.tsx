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
 * ## This is `ConfirmDialog`, in the language of the redesign
 *
 * `src/components/ConfirmDialog.tsx` is the working app's version of this
 * decision and every decision it made is kept: the destructive button first and
 * outlined rather than filled, the keep-it button beside it and the one a thumb
 * lands on, the card sitting at the bottom of a short screen and centred on a
 * tall one. What is different is only the paint, because the gallery draws the
 * redesign and loads none of the app's stylesheet. When this is built it is
 * `ConfirmDialog` carrying this content, not a second dialog.
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
  onAct?: () => void
  onKeep?: () => void
}) {
  return (
    <div className="wf-sure" role="dialog" aria-modal="true" aria-label={title}>
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
          <Button tone="danger" onPress={onAct}>
            {act}
          </Button>
          <Button tone="secondary" onPress={onKeep}>
            Keep it
          </Button>
        </div>
      </div>
    </div>
  )
}
