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
 *
 * ## The second line dropped below the first
 *
 * This used to be an eyebrow: small capitals, wide tracking, its own line
 * *above* the title. Walking the first round on his phone the owner said the
 * waiting card should sit lower and take less room, and the eyebrow was where
 * the room was going: a full tracked line spent on a word like "Waiting"
 * before the sentence that actually says something.
 *
 * So `kind` is now the second line rather than the first. The title leads and
 * gets read; the kind of thing the card is follows it, quietly, at the size
 * nothing else in the system uses. Nothing lost: "Never Let Me Go / found in
 * Open Library" is the same two facts in the order somebody wants them.
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
 *
 * **It says one sentence and no second one.** There was a `where` line under
 * this that spelled out the position in words, and the owner asked for the
 * opposite: "we should show where it is on the shelf by highlighting it, kind
 * of what we've done on the old UI, not just tell them where it is. Give them
 * a visual." So the drawing does that job, on the screen, under this: the same
 * run of books with the book standing in it, marked the way `Shelf` already
 * marks the book a screen is about. Two spellings of one fact is how they get
 * to disagree.
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
