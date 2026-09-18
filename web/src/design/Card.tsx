/**
 * The things that hold content. A card has no coloured rail down its side,
 * not as a variant, not for an error, not to group two of them: say the
 * thing in words at the top instead.
 *
 * Three weights and no more: raised off the page, sunk (a well inside another
 * card), or quiet (a dashed outline for something not there yet).
 *
 * `kind` is the second line, below the title, quietly: the title leads and
 * gets read first.
 */

import type { ReactNode } from 'react'
import { Cat } from './Cat'

export function Card({
  kind,
  title,
  weight = 'raised',
  children,
  foot,
}: {
  /** What kind of thing this card is, said under the title. Quiet, small. */
  kind?: string
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
      {(kind || title) && (
        <div className="wf-card__head">
          {title && <h2 className="wf-card__title">{title}</h2>}
          {kind && <span className="wf-card__kind">{kind}</span>}
        </div>
      )}
      {children && <div className="wf-card__body">{children}</div>}
      {foot && <div className="wf-card__foot">{foot}</div>}
    </section>
  )
}

/** The one line a screen exists to say, set in the book face because it names books. */
export function Instruction({ children }: { children: ReactNode }) {
  return <p className="wf-instruction">{children}</p>
}

/** What just happened, under the instruction, quietly. */
export function Said({ children }: { children: ReactNode }) {
  return <p className="wf-said">{children}</p>
}

/**
 * The end of a journey. The cat is a loaf because the job is done, and the
 * wash behind him is the only large tinted area in the whole system. Says one
 * sentence and no second one: where the book is comes from the shelf drawing
 * below it, marked the way `Shelf` marks the book a screen is about.
 */
export function Confirmation({ said, children }: { said: string; children?: ReactNode }) {
  return (
    <div className="wf-confirm">
      <Cat pose="loaf" size={64} label="Done" />
      <p className="wf-confirm__said">{said}</p>
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
