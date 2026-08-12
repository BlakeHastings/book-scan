/**
 * The parts a book's own page is made of.
 *
 * These exist because the book screen stopped being a location widget. The
 * owner read the old one and named what was wrong with it:
 *
 * > This is the detailed view for a book. Where it is, is one part of that.
 * > It's not the whole picture.
 *
 * So the page answers "what do I know about this book, and what can I do with
 * it", and where it sits is one section of several. Everything here is a thing
 * the catalogue actually holds: the photographs, the two forms of an author's
 * name, the tags and who said each one, and the rows behind where a book is.
 *
 * ## Nothing here is a table of fields
 *
 * The queue's review screen is the reference, and what it does is say the
 * facts in a sentence: "Ishiguro, Kazuo, Faber, 2005, 288 pages". A phone is
 * 414 wide and a label column eats half of it to repeat words a reader can
 * already see the shape of, so publisher, year and length read as one line and
 * the label is dropped.
 */

import type { ReactNode } from 'react'
import { Place } from './List'
import type { Cloth } from './Shelf'

/**
 * A section of the page: a title, an optional count beside it, and content.
 *
 * Not a card. Five cards down a scroll is five outlines competing with each
 * other, and the thing this screen needed most was room, so a section is a
 * heading and the content under it. Cards are kept for the two places on this
 * page where something really is a box: a thing that is not there yet, and a
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
 * The top of the page: the front of the book, and what it is.
 *
 * The title is here as well as in the top bar because the bar truncates on one
 * line, and a title is the one thing a page about a book may not lose. The
 * author is the name as printed on the cover; where it files is a fact about
 * the author rather than about this copy, so it is said in the section that is
 * about the author.
 */
export function Head({
  title,
  by,
  cover,
  facts,
}: {
  title: string
  /** Credited as printed, which is not always what it files under. */
  by: string
  /** The binding of the front photograph. Absent when there is none. */
  cover?: Cloth
  /** One line each: publisher and year, the series, the ISBN. */
  facts: string[]
}) {
  return (
    <div className="wf-book">
      {cover ? (
        <span className={`wf-book__cover wf-spine--${cover}`} aria-hidden="true" />
      ) : (
        <span className="wf-book__cover wf-book__cover--none">No photograph</span>
      )}
      <div className="wf-book__of">
        <h2 className="wf-book__title">{title}</h2>
        <p className="wf-book__by">{by}</p>
        {facts.map((fact) => (
          <p className="wf-book__fact" key={fact}>
            {fact}
          </p>
        ))}
      </div>
    </div>
  )
}

/*
 * The rail of a book's photographs used to live here, and it is now `Shots` in
 * `Shots.tsx`, because the camera grew a component of the same name emitting
 * the same class names and the two quietly broke each other. One component,
 * one home, and a mode for whether a person can act on what they are seeing.
 */

/**
 * A tag, and who said it.
 *
 * **This is the one thing on the page that is not decoration.** A tag carries
 * a source and a confidence everywhere else in this product: a person deciding,
 * a catalogue claiming, or this app inferring over what a catalogue said. Only
 * a person's is safe from an automatic rewrite, and the whole placement story
 * rests on that difference, so it has to be visible where somebody reads their
 * tags rather than only in the rules that consume them.
 *
 * Said twice, in words and in the outline. The words carry it: "You said so"
 * is not "The app guessed". The outline follows the language the rest of the
 * system already speaks, where a dashed edge is something provisional, so a
 * guess is dashed and a person's answer is drawn solid.
 */
export function Tagged({
  word,
  who,
  from = 'person',
}: {
  word: string
  /** Who said it, in a sentence. Where the confidence is said too. */
  who: string
  /** Which of the three said it. */
  from?: 'person' | 'catalogue' | 'guess'
}) {
  return (
    <div className={`wf-voice wf-voice--${from}`}>
      <span className="wf-tag">{word}</span>
      <span className="wf-voice__who">{who}</span>
    </div>
  )
}

export function Tagging({ children }: { children: ReactNode }) {
  return <div className="wf-voices">{children}</div>
}

/**
 * What you can do about the section above: small, side by side, left.
 *
 * A section is a grid, so a button dropped straight into one stretches the
 * width of the phone and reads as the thing the screen is for. Nothing on this
 * page is: the whole point of it is that a book has several sections and none
 * of them owns the screen. So every action here is in one of these rows, and
 * the only full-width button a book's page has is the one it does not have.
 */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="wf-actions">{children}</div>
}

/**
 * Where the book is, in one line.
 *
 * This was a card with a heading, a sentence and three full-width buttons, and
 * the owner's words about it were "that's just taking up way too much space".
 * It is a label, a sentence and a date now, and the things you can do about it
 * are small buttons underneath rather than the widest thing on the screen.
 *
 * A book that is not on a bookcase gets the outlined label rather than no
 * label, because "not here" is an answer and it belongs in the same place a
 * reader looks for the other one. A book that is on one gets no label at all,
 * because the board drawn beside it already carries one and the same two
 * characters twice in three inches is the thing that made the old card look
 * like a widget. Found by looking at it.
 */
export function Here({
  label,
  quiet = false,
  said,
  when,
}: {
  /** Where it is, when nothing else on the screen says. */
  label?: string
  /** The book is not on a bookcase: out, or never put anywhere. */
  quiet?: boolean
  said: string
  when: string
}) {
  return (
    <div className="wf-here">
      {label && <Place quiet={quiet}>{label}</Place>}
      <span className="wf-here__text">
        <span className="wf-here__said">{said}</span>
        <span className="wf-here__when">{when}</span>
      </span>
    </div>
  )
}

/**
 * Where it has been, which the catalogue can answer now.
 *
 * Every move is a row, so this is not a second record kept for the screen: it
 * is the same rows the app reads to say where the book is, read further back.
 * It earns the space at the bottom of the page for one reason, which the two
 * screens show between them: for a book in the house it is history, and for a
 * book that is out of the house it is the only thing that says where it goes
 * back.
 *
 * A row says who, where that is not obvious. Somebody carrying a book and the
 * app deciding a book should move are different events, and the ledger is what
 * knows which one happened.
 */
export function Been({
  rows,
}: {
  rows: { what: string; when: string; who?: string }[]
}) {
  return (
    <div className="wf-been" role="list" aria-label="Where it has been">
      {rows.map((row) => (
        <div className="wf-been__row" role="listitem" key={`${row.what}${row.when}`}>
          <span className="wf-been__what">
            {row.what}
            {row.who && <span className="wf-been__who">{row.who}</span>}
          </span>
          <span className="wf-been__when">{row.when}</span>
        </div>
      ))}
    </div>
  )
}
