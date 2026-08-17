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
 * ## Doing comes before knowing, which is the order of the whole page
 *
 * > We should have the actions available to the user the moment they get to
 * > this detail view, so they can do whatever it is that they intend to do. And
 * > then if they don't intend to take action, when they scroll down they see
 * > the current shelving view, and that shows them where it is, which might be
 * > what they're here for.
 *
 * Somebody arriving at a book either wants to **do** something or wants to
 * **know** where it is, and the second of those is what they scroll to anyway.
 * So the top of the page is the book, its facts, its tags and what can be done
 * about it, and everything that answers "where" is below the fold: where it
 * sits, why it sits there, and what else is here by the same author. Putting
 * the doing first costs the knowing nothing.
 *
 * The screens are where that order lives, in `gallery/screens.tsx`, because it
 * is an arrangement of sections rather than a property of any one of them.
 *
 * ## Round eight took most of the headings off
 *
 * > And "what you can do", we don't need that text there either. We should just
 * > enable them to take action on a book with a series of buttons.
 *
 * Three headings went and none of their contents did. The tags moved up beside
 * the picture, under the publisher and the ISBN, and read as facts about the
 * book; the actions are a row of buttons with nothing over them, because a
 * button says what pressing it does; the board draws where the book is without
 * being introduced. `Part` is still here and still has a heading, because one
 * section left on the page genuinely needs announcing: what else there is by
 * the same author is not visible from anything else on the screen.
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
import { Shots, type FirstPicture, type Shot } from './Shots'

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
 * The top of the page: the book, and what it is.
 *
 * The title is here as well as in the top bar because the bar truncates on one
 * line, and a title is the one thing a page about a book may not lose. The
 * author is the name as printed on the cover; where it files is a fact about
 * the author rather than about this copy, so it is said in the section that is
 * about the author.
 *
 * ## The photographs are the book, and there is no rail under them
 *
 * This used to be a cover here and a rail of every photograph beneath it, and
 * the owner rejected both halves of that in one sentence: the spine belongs
 * against the front, cropped to the sliver a spine photograph really is, and
 * the others belong behind the front where a swipe reaches them. `Shots` in
 * `mode="book"` is that arrangement, and it is the same component the camera
 * and the review draw, because a second one is what this file already learned
 * not to have.
 *
 * ## It fills the width, which it did not
 *
 * > It seems like the upper area doesn't actually fully expand to fill the
 * > entire space. There's a big gap on the right side.
 *
 * Two faults, one on each side of that gap. The rail underneath was four
 * fixed boxes in a row, so it stopped a third of the way short of the right
 * edge whatever the phone was; that rail is gone. And this row's text was a
 * flex item at its natural width, so on a short title or a thin record it
 * stopped short too. It is `flex: 1` now and reaches the edge.
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
  /**
   * What the book is about, under the publisher and the ISBN and beside the
   * picture, which is where the owner put it:
   *
   * > The tags should be underneath where we show the publisher and the ISBN,
   * > next to the picture. We should just have the tags get listed there and
   * > wrapped, rather than "what it is about" as a separate header.
   *
   * A heading of its own said nothing the chips do not, and it cost a section
   * on a page whose whole complaint was that it had too many. What a book is
   * about is a fact about the book, so it reads with the other facts.
   */
  tags?: ReactNode
  /** Which picture the book opens on. See `FirstPicture`. */
  first?: FirstPicture
}) {
  return (
    <div className="wf-book">
      <Shots shots={shots} mode="book" first={first} />
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
 * A tag, drawn as firmly as whoever said it.
 *
 * **This is the one thing on the page that is not decoration.** A tag carries
 * a source and a confidence everywhere else in this product: a person deciding,
 * a catalogue claiming, or this app inferring over what a catalogue said. Only
 * a person's is safe from an automatic rewrite, and the whole placement story
 * rests on that difference, so it has to be visible where somebody reads their
 * tags rather than only in the rules that consume them.
 *
 * It used to be said twice, in the outline and in a sentence beside it, and
 * the owner cut the sentence:
 *
 * > We don't need to tell them who says so right here. Just show them.
 *
 * So the difference stays and the sentence goes, which means the drawing has
 * to carry all of it. Three steps of firmness, which is an order rather than
 * three unrelated treatments: a person's answer is filled and ringed, a
 * catalogue's is the ordinary chip, and this app's own guess is a dashed
 * outline, which is what a dashed edge already means everywhere here.
 *
 * `who` is still a required word for it, on the element rather than beside it.
 * A screen reader gets the whole sentence and so does anybody resting on the
 * chip, and neither costs a line of the page.
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
 * What you can do, small, side by side, left.
 *
 * A section is a grid, so a button dropped straight into one stretches the
 * width of the phone and reads as the thing the screen is for. Nothing on this
 * page is: the whole point of it is that a book has several sections and none
 * of them owns the screen. So every action here is in one of these rows, and
 * the only full-width button a book's page has is the one it does not have.
 *
 * **The row moved up and did not grow**, which is the harder half of what was
 * asked for. Actions now sit under the tags, above everything about where the
 * book is, and a row that is the first thing a thumb reaches is exactly the row
 * that fills up with every verb the model can spell. Three is what the rich
 * book gets and two is what the thin one gets; the screens say which and say
 * what was kept out.
 */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="wf-actions">{children}</div>
}

/*
 * There was a `Here` here, and it is gone.
 *
 * It drew where the book is as a sentence and a date, over the drawing of the
 * board that says the same thing: "On bookcase 1, where it should be. Last
 * confirmed there on 4 August." The owner cut it on sight, and named the rule
 * rather than the sentence:
 *
 * > We can remove all of that. Literally the view we have below that shows it.
 * > We don't need to explain it verbally with words.
 *
 * That is #262's rule reaching the last place it had survived: a sentence that
 * says what the screen already draws is not a summary, it is a second thing to
 * keep true. What was left of the component after the sentence went was a
 * wrapper around `Place`, so the screen that still needs a label wears `Place`
 * itself and there is nothing in between.
 *
 * A book that is **not** on a bookcase still gets that label, because "Out" is
 * an answer and there is no board drawn for it to be read off. A book that is
 * on one gets none: the board beside it carries its own.
 */

/**
 * Where the book stands, drawn and not announced.
 *
 * > And instead of "where it is", once again, we don't need that text there.
 * > Looking at this tells them where it is.
 *
 * So this is a `Part` with the heading taken off it, and it is a component of
 * its own rather than a flag on that one because the argument for the missing
 * heading has to live somewhere. **The section is still named**, on the
 * element: a sighted reader has the board in front of them and a screen reader
 * has a run of spines with no sentence anywhere saying what it is a run of.
 * The name is the same words the heading used, so nothing is renamed, only
 * unwritten. That is #262's rule reaching this heading: the drawing says it,
 * and a line of text over the drawing is a second thing to keep true.
 *
 * ## It stays below everything about the book, and it stays one section
 *
 * The pinned rule is that a book screen is about the book rather than about
 * where it sits, and this round takes material off this section rather than
 * adding any: the ledger of where it has been is gone entirely and the heading
 * with it. What is left is the board, and the one question a person asks after
 * looking at it, which is why a rule put the book there. That is a fact about
 * the book.
 */
export function Where({ children }: { children: ReactNode }) {
  return (
    <section className="wf-part" aria-label="Where it is">
      {children}
    </section>
  )
}

/*
 * There was a `Been` here, and it is gone with the section it drew.
 *
 * It listed every move a book had made, newest first, and the owner had said
 * twice that he liked it. He then read the page again and cut it:
 *
 * > I think we can get rid of "where it has been" as well [...] Actually, I
 * > think we just get rid of the "where it has been" section.
 *
 * Nothing replaced it and nothing shorter was written in its place, which is
 * the trap #262 names. The moves themselves are untouched: they are the same
 * rows the app reads to say where a book is, `/api/books/:id/placements` still
 * answers with them, and the misfile list still rests on the difference
 * between the app assigning a book and somebody carrying one. What is gone is
 * a screen that read them out.
 */
