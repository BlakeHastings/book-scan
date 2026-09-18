/**
 * A stop before something that cannot be undone. Ambient prose is noise, but
 * an explanation at the moment of an irreversible decision is the whole job:
 * nothing here is allowed onto a screen ambiently, it is drawn when somebody
 * asks for the irreversible thing, says what will happen to their own books
 * with the count in it, and goes away again.
 *
 * A one-press decision that affects many books at once also asks here even
 * when it is reversible, since its consequence is not visible from the
 * button; the line under the title says the work can be put back in that case.
 *
 * The "what reads differently afterwards" list exists because labels here are
 * worked out from where a thing sits, so removing one area renames every area
 * after it, and a sentence claiming that is worth less than rows showing it.
 */

import type { ReactNode } from 'react'
import { Button } from './Controls'
import { Place } from './List'

/**
 * The card a screen is asked over, without the question on it. `Sure` is one
 * question asked on this card, but not the only one: correcting an ISBN is
 * asked here too, with a keyboard and two answers rather than a stop before
 * something irreversible. The screen under it stays drawn, and pressing it is
 * the same as taking the quiet way out.
 */
export function Asked({
  title,
  said,
  onOut,
  children,
}: {
  /** What is being asked, in the words of the thing it is about. */
  title: string
  /** The rest of what they need before they answer. Two sentences at most. */
  said?: ReactNode
  /** Pressing the page around the card. Always the answer that changes least. */
  onOut?: () => void
  children?: ReactNode
}) {
  return (
    /* Only the page itself: a press that started on the card is somebody reading it. */
    <div
      className="wf-sure"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => { if (event.target === event.currentTarget) onOut?.() }}
    >
      <div className="wf-sure__card">
        <h2 className="wf-sure__title">{title}</h2>
        {said && <p className="wf-sure__said">{said}</p>}
        {children}
      </div>
    </div>
  )
}

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
  /** The answer is being carried out right now, so neither button is pressable. */
  busy?: boolean
  onAct?: () => void
  onKeep?: () => void
}) {
  return (
    /* Pressing the page around the card is the same answer as "Keep it". */
    <Asked title={title} said={said} onOut={onKeep}>
      <>
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

        {/* Destructive first, keep-it second: the one a thumb finds without aiming is the one that changes nothing. */}
        <div className="wf-sure__acts">
          <Button tone="danger" off={busy} onPress={onAct}>
            {act}
          </Button>
          <Button tone="secondary" off={busy} onPress={onKeep}>
            Keep it
          </Button>
        </div>
      </>
    </Asked>
  )
}
