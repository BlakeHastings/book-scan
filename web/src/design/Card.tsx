/**
 * The things that hold content.
 *
 * **A card has no coloured rail down its side.** Not as a variant, not for
 * an error, not to group two of them. It was named as an AI fingerprint and
 * rejected, and the honest replacement is what a card should have done in the
 * first place: say the thing in words at the top of it.
 *
 * Three weights and no more. A card is raised off the page, a sunk one is a
 * well inside another card, and a quiet one is a dashed outline for something
 * that is not there yet.
 */

import type { ReactNode } from 'react'
import { Cat } from './Cat'

export function Card({
  eyebrow,
  title,
  weight = 'raised',
  children,
  foot,
}: {
  /** Small capitals above the title. The kind of thing this card is. */
  eyebrow?: string
  title?: string
  weight?: 'raised' | 'sunk' | 'quiet'
  children?: ReactNode
  /** Buttons along the bottom, sharing the width. */
  foot?: ReactNode
}) {
  return (
    <section
      className={`wf-card${weight === 'raised' ? '' : ` wf-card--${weight}`}`}
    >
      {(eyebrow || title) && (
        <div className="wf-card__head">
          {eyebrow && <span className="wf-card__eyebrow">{eyebrow}</span>}
          {title && <h2 className="wf-card__title">{title}</h2>}
        </div>
      )}
      {children && <div className="wf-card__body">{children}</div>}
      {foot && <div className="wf-card__foot">{foot}</div>}
    </section>
  )
}

/**
 * The one line a screen exists to say, set in the book face because it names
 * books. `text-wrap: balance` matters more here than anywhere: this is the
 * sentence somebody reads while walking to a shelf with a book in their hand,
 * and a two-word orphan line is what it looked like before.
 */
export function Instruction({ children }: { children: ReactNode }) {
  return <p className="wf-instruction">{children}</p>
}

/** What just happened, under the instruction, quietly. */
export function Said({ children }: { children: ReactNode }) {
  return <p className="wf-said">{children}</p>
}

/**
 * The end of a journey. The cat is a loaf because the job is done, and the
 * wash behind him is the only large tinted area in the whole system.
 */
export function Confirmation({
  said,
  where,
  children,
}: {
  said: string
  /** Where the book ended up, in the words the shelf uses. */
  where?: string
  children?: ReactNode
}) {
  return (
    <div className="wf-confirm">
      <Cat pose="loaf" size={64} label="Done" />
      <p className="wf-confirm__said">{said}</p>
      {where && <p className="wf-confirm__where">{where}</p>}
      {children}
    </div>
  )
}

/** Nothing here, and that is fine. */
export function Nothing({ said, children }: { said: string; children?: ReactNode }) {
  return (
    <div className="wf-empty">
      <Cat pose="sleeping" size={44} />
      <p className="wf-empty__said">{said}</p>
      {children}
    </div>
  )
}
