/**
 * The parts a book's own page is made of. The page answers "what do I know
 * about this book, and what can I do with it" first; where it sits is one
 * section among several, below the fold. That ordering lives in
 * `gallery/screens.tsx` as an arrangement of sections rather than a property
 * of any one of them.
 */

import type { ReactNode } from 'react'
import { IconCarry, IconOnward } from './Icons'
import { Shots, type FirstPicture, type Shot } from './Shots'

/**
 * A section of the page: a title, an optional count beside it, and content.
 * Not a card; cards are kept only for a thing that is not there yet, and a
 * question the app cannot answer.
 */
export function Part({
  head,
  note,
  children,
}: {
  head: string
  /** A count, usually. Set on the right of the heading, quietly. */
  note?: string
  children: ReactNode
}) {
  return (
    <section className="wf-part" aria-label={head}>
      <div className="wf-part__head">
        <h2 className="wf-part__title">{head}</h2>
        {note && <span className="wf-part__note">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * The top of the page: the book, and what it is.
 *
 * The title is here as well as in the top bar because the bar truncates on one
 * line. The author is the name as printed on the cover; where it files is a
 * fact about the author rather than about this copy, so it is said in the
 * section about the author.
 *
 * `Shots` in `mode="book"` draws the photographs, the same component the
 * camera and the review use. This is the only caller in the design system
 * that passes `full`, turning each picture into a target that opens the full
 * view: a queue row draws a book the same way but is itself one whole button,
 * so it never asks for that.
 */
export function Head({
  title,
  by,
  shots,
  facts,
  tags,
  first = 'catalogue',
}: {
  title: string
  /** Credited as printed, which is not always what it files under. */
  by: string
  /** Every photograph of this book. The one marked `sliver` is the spine. */
  shots: Shot[]
  /** One line each: publisher and year, the series, the ISBN. */
  facts: string[]
  /** What the book is about, read as a fact beside the other facts rather than under its own heading. */
  tags?: ReactNode
  /** Which picture the book opens on. See `FirstPicture`. */
  first?: FirstPicture
}) {
  return (
    <div className="wf-book">
      <Shots shots={shots} mode="book" first={first} full />
      <div className="wf-book__of">
        <h2 className="wf-book__title">{title}</h2>
        <p className="wf-book__by">{by}</p>
        {facts.map((fact) => (
          <p className="wf-book__fact" key={fact}>
            {fact}
          </p>
        ))}
        {tags}
      </div>
    </div>
  )
}

/**
 * A tag, drawn as firmly as whoever said it. A person's tag is filled and
 * ringed, a catalogue's is the ordinary chip, and this app's own guess is a
 * dashed outline, the same meaning a dashed edge carries everywhere else here.
 * Only a person's tag is safe from an automatic rewrite, so this difference
 * has to be visible where somebody reads their tags, not only in the rules
 * that consume them. `who` is carried on the element rather than drawn beside
 * it.
 */
export function Tagged({
  word,
  who,
  from = 'person',
}: {
  word: string
  /** Who said it. Not drawn: it is the tag's own name and its title. */
  who: string
  /** Which of the three said it. */
  from?: 'person' | 'catalogue' | 'guess'
}) {
  return (
    <span className={`wf-tag wf-voice wf-voice--${from}`} title={who} aria-label={`${word}, ${who}`}>
      {word}
    </span>
  )
}

/** The tags of one book, wrapping across the width rather than one to a line. */
export function Tagging({ children }: { children: ReactNode }) {
  return <div className="wf-voices">{children}</div>
}

/**
 * What you can do, small, side by side, left. A button dropped straight into
 * a section stretches full width and reads as the thing the screen is for,
 * which nothing on a book's page is meant to be, so every action here sits in
 * one of these rows instead.
 */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="wf-actions">{children}</div>
}

/**
 * A book the order wants somewhere else, said in one sentence and pressed.
 * The notice itself is the only target: pressing it opens the same shelving
 * step a newly scanned book is placed on, rather than offering an "I moved
 * it" answer inline. The sentence is fixed here rather than passed in, since
 * it says the same thing about every book that is out of place. Colour here
 * is emphasis only: every element also reads correctly with the colour
 * removed.
 */
export function Amiss({ onPress }: { onPress?: () => void }) {
  return (
    <button type="button" className="wf-amiss" onClick={onPress}>
      <span className="wf-amiss__mark" aria-hidden="true">
        <IconCarry size={20} />
      </span>
      <span className="wf-amiss__said">This book is supposed to be moved.</span>
      <span className="wf-amiss__onward" aria-hidden="true">
        <IconOnward size={18} />
      </span>
    </button>
  )
}

/**
 * Where the book stands, drawn and not announced: a `Part` with the heading
 * taken off. The section is still named on the element for a screen reader, in
 * the same words the heading used. A book not on a bookcase still gets that
 * label ("Out"), since there is no board to read it off; a book on one gets
 * none, since the board beside it carries its own.
 */
export function Where({ children }: { children: ReactNode }) {
  return (
    <section className="wf-part" aria-label="Where it is">
      {children}
    </section>
  )
}
