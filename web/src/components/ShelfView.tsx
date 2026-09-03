/**
 * The shelves as they physically are, and the books that are not on them.
 *
 * Converted to the design system by #387, which is the last screen in the app
 * that wore the app's own header and its own three-place row of pills. What it
 * does is unchanged: this is a conversion, and every decision underneath it is
 * still the one the screen was carrying.
 *
 * ## The gallery draws this screen's middle and not its edges
 *
 * There is no `shelves` in `design/gallery/screens.tsx`. What is drawn there is
 * `library`, `listing` and `covers`: the same books, in the same order, grouped
 * the same way, in the three drawings a person picks between (#82). So the three
 * drawings are the drawn ones, imported rather than copied, and they are the
 * same three `LibraryPane` builds:
 *
 *   - the board, `Shelf`, one per area, which never wraps because a break in a
 *     run means "a new area" everywhere else here (#81);
 *   - the list, `List` and `Row`, a line per book;
 *   - the gallery, `Covers`, which is allowed to wrap precisely because it is
 *     not pretending to be a photograph of the furniture.
 *
 * What the gallery has no drawing of is everything this screen exists for: the
 * misfile list, the books off the bookcase, the boundary lines and the books a
 * boundary change asks somebody to carry. Those keep their words and are dressed
 * in `Card`, `List` and `Said`, which is what the design system says to do with
 * a fact: say the thing in words at the top of it.
 *
 * ## Two drawings of a shelf, and this one lost
 *
 * `ShelfStrip` drew this screen's spines and `design/Shelf.tsx` drew the
 * gallery's, and they disagreed about four things: how wide a book is, what
 * marks the one book a screen is about, whether a spine carries the number you
 * count along to, and whether the run ends in anything. The design system wins
 * every one of them, because those answers are the owner's and are written down
 * where he gave them. `ShelfStrip` is now what its name says and nothing else:
 * the strip with a gap in it that the placing step draws.
 *
 * **The count-along number is gone with it**, which is the one thing this screen
 * loses. `Shelf` draws no number on a spine and never has, the library screen
 * has been drawn without one since #315, and two shelves in one app numbered
 * differently is worse than neither being numbered.
 *
 * ## The misfile list is the reason this screen is reachable
 *
 * #358 repaired it after it had been silently setting 181 of 238 books aside,
 * and it is drawn here and nowhere else. Every part of it is kept: the count
 * that is not zero above the list, the two answers per book, "Undo the move"
 * offered only where the server says a move is outstanding, and the sentence
 * about books nobody has ever confirmed onto a bookcase. The words are the
 * words it had.
 *
 * A boundary move is not offered here at all (#96). It is one book's own
 * business, so it lives on that book's page, only when the book is genuinely
 * at an edge; a control drawn into every area, in three different drawings, is
 * one mistap away from moving a book nobody meant to touch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, Refusal, type AreaGoing, type CheckedOutAt, type Counts, type Misfile,
  type Move, type ShelfGroupDto, type ShelvingReviewResponse,
} from '../lib/api'
import { canTakeBack, notChecked, recordMoved, takeMoveBack } from '../lib/misfile'
import { coverNote, coverOf, listOf, missingFrom, spineLabel, spineOf } from '../lib/shelfRow'
import { libraryRows } from '../../shared/layout'
import { bestKnownAuthor, type ShelfRange } from '../../shared/shelving'
import { Card, Nothing, Said } from '../design/Card'
import { TopBar } from '../design/Chrome'
import { Button, Segmented } from '../design/Controls'
import { Covers, type CoverItem } from '../design/Covers'
import { Filter } from '../design/Finding'
import { List, Row } from '../design/List'
import { Shelf, type ShelfItem } from '../design/Shelf'
import { Sure } from '../design/Sure'
import { clothFor, coverArt, filedAs, pagesOf, spineArt } from '../lib/bookLook'
import { plural, saidBooks, sharedSaid } from '../lib/carryWords'
import { pieceOn } from '../lib/furniture'
import { useBrowsing } from '../app/browsing'
import { Frame } from './Frame'
import { Trouble } from './RoomFrame'

/**
 * Where the library was when a book was opened from it, so coming back lands
 * there rather than at the top of the first bookcase.
 *
 * Both axes, because this view now has two. The page scroll says which area
 * you were looking at; the book says where along that area's row you were,
 * and it is stored as an id rather than a pixel offset so the row can have
 * moved underneath you and still land in the right place.
 *
 * **The horizontal half is now the cat** (#387). It used to be a map of every
 * spine's element and a `scrollIntoView` on the one that was opened, and
 * `Shelf` already does exactly that for the book a screen is about: it puts the
 * cat on top of it and brings it into the run. So coming back marks the book
 * you came back from, which is both the restore and the answer to "which one
 * was I looking at".
 */
export interface LibraryReturnAnchor {
  range: ShelfRange
  bookId: number
  scrollY: number
}

interface Props {
  onOpen: (id: number, anchor: LibraryReturnAnchor) => void
  /**
   * Set when this mount is a return trip from a book's detail view. Used once
   * to put the person back where they were, then reported as consumed.
   */
  returnAnchor?: LibraryReturnAnchor | null
  onReturnAnchorConsumed?: () => void
  /** Back to the library, which is the only door into this screen. */
  onBack?: () => void
  /**
   * Take this whole run somewhere else.
   *
   * Carries the range out because this component is unmounted the moment the
   * screen changes, so the tab it was on cannot be asked for afterwards. The
   * same reason the return anchor is passed up rather than kept here.
   */
  onArrange?: (range: ShelfRange) => void
  /**
   * The way through to the furniture, and the only one there is (#313).
   *
   * It belongs here rather than on the first screen for the reason the drawing
   * puts it here: describing the room is something you do while looking at
   * what is in it. It is a quiet button under the shelves and not a card with
   * a paragraph over it, which is what was there before the owner read it:
   * "the app has no reason to summarise what somebody's furniture is made of".
   */
  onFurniture?: () => void
}

export function ShelfView({
  onOpen, returnAnchor, onReturnAnchorConsumed, onBack, onArrange, onFurniture,
}: Props) {
  // A return trip opens on the range it left from, or the tab would change
  // under the person while they were away.
  const [range, setRange] = useState<ShelfRange>(returnAnchor?.range ?? 'fiction')
  /*
   * Which of the three drawings, from the same place the library screen reads
   * it. One preference, one storage key, and it was already the same key before
   * this screen was converted: a person who chooses covers on one of the two
   * screens that draw every book they own has not chosen it on only one of them.
   */
  const { look, setLook } = useBrowsing()
  const [groups, setGroups] = useState<ShelfGroupDto[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [counts, setCounts] = useState<Counts | null>(null)
  const [off, setOff] = useState<CheckedOutAt[]>([])
  const [review, setReview] = useState<ShelvingReviewResponse | null>(null)
  const [moving, setMoving] = useState(0)
  /*
   * The line somebody has pressed Remove on and has not yet answered about,
   * with what the server said it would cost. Null the rest of the time, which
   * is every moment nothing is being asked.
   */
  const [going, setGoing] = useState<{ id: number; cost: AreaGoing } | null>(null)
  /*
   * The anchor this mount was born with, which is the only one that means
   * "you are coming back".
   *
   * Read from the prop once, on the first render, and never again. Opening a
   * book records an anchor while this view is still on screen, since the book
   * has to be fetched before the screen changes. Watching the prop would see
   * that one arrive, treat the visit it is still in the middle of as a return
   * trip, and consume it, so the actual return had nothing left to restore.
   */
  const arrivedWith = useRef(returnAnchor ?? null)
  // A fresh mount every time the shelves are shown, so this only needs to fire
  // once per visit.
  const restored = useRef(false)

  /*
   * Both tallies, not just this tab's. A non-fiction book saved while the
   * shelves sit on Fiction is invisible with no hint it exists, which reads
   * as the save having silently failed rather than as a tab being unopened.
   */
  useEffect(() => {
    api.health().then((h) => setCounts(h.counts)).catch(() => {})
  }, [groups])

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([api.shelves(range), api.misfiles(range)])
      .then(([shelves, flagged]) => {
        setGroups(shelves.groups)
        setOff(shelves.checkedOut)
        setReview(flagged)
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false))
  }, [range])

  useEffect(() => { load() }, [load])

  /**
   * Put the person back where they were reading, not at the top.
   *
   * A row can be forty books long, and the page is a stack of those rows, so
   * both axes have to be restored or coming back from a book means hunting
   * for the place you had already found. This is the vertical half; the
   * horizontal half is `Shelf`, which brings the marked book into its own run.
   *
   * It runs after `Shelf`'s does, because a child's effects fire before its
   * parent's, so the page lands where the person left it rather than wherever
   * bringing one spine into view put it.
   *
   * Registers as consumed whether or not the book is still there. It can have
   * been deleted, or checked out and so no longer in the run at all, and in
   * that case the vertical position alone is the best answer available.
   */
  useEffect(() => {
    const anchor = arrivedWith.current
    if (restored.current || loading || !anchor) return
    restored.current = true

    window.scrollTo({ top: anchor.scrollY })
    onReturnAnchorConsumed?.()
  }, [groups, loading, onReturnAnchorConsumed])

  /** Open a book, remembering enough to come back to this exact spot. */
  const open = (id: number) =>
    onOpen(id, { range, bookId: id, scrollY: window.scrollY })

  /**
   * The person says they have carried this book to where it belongs.
   *
   * Nothing here decides that on their behalf. The list is a report, and a
   * book stays on it until somebody has actually been to the shelf, because
   * writing the answer we would like to be true would destroy the only record
   * of where the book really is.
   *
   * Through `recordMoved`, which sends the plank rather than the row's label:
   * this list is drawn once and acted on minutes later, and a label is a
   * rendering that reads differently the moment somebody names the piece it is
   * on (#356).
   */
  const confirmMoved = async (misfile: Misfile) => {
    setMoving(misfile.book.id)
    setError('')
    try {
      await recordMoved(misfile)
      load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setMoving(0)
    }
  }

  /**
   * The person says they never picked this book up, so the move goes back.
   *
   * The other end of the same row. "Moved it" closes the gap by recording that
   * somebody walked to a shelf; this closes it by withdrawing an assignment
   * nobody acted on, and writes no location at all, because nothing about the
   * room has changed. Without it the only way out of a mistapped move was to
   * claim the walk and then move the book back: two false statements to undo
   * one tap (#196).
   */
  const takeBack = async (misfile: Misfile) => {
    setMoving(misfile.book.id)
    setError('')
    try {
      await takeMoveBack(range, misfile.book.id)
      load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setMoving(0)
    }
  }

  /**
   * Press Remove on the line between two areas.
   *
   * **The first press is a question, never the act** (#456). The server refuses
   * a removal nobody has been asked about and hands back what it would cost, so
   * this asks with that rather than with anything it worked out for itself, and
   * the second press is the answer. Before this, one tap took an area off the
   * furniture and moved its books, and the only thing the person saw was the
   * carry list drawn afterwards, which is a list of what has already happened.
   *
   * The refusal is the server's and not this screen's on purpose: a control
   * that only appears after a dialog is one caller away from being lost, which
   * is how this door stayed open while the other two were shut.
   */
  const removeSeparator = async (id: number, theAreaGoes = false) => {
    setError('')
    try {
      const result = await api.removeSeparator(id, range, theAreaGoes)
      setGroups(result.groups)
      setMoves(result.moves)
      setGoing(null)
    } catch (caught) {
      if (caught instanceof Refusal && caught.effect) {
        setGoing({ id, cost: caught.effect as AreaGoing })
        return
      }
      setError((caught as Error).message)
      setGoing(null)
    }
  }

  const misfiles = review?.misfiles ?? []
  const unplaced = (review?.excluded ?? [])
    .filter((entry) => entry.reason === 'never-placed').length
  /*
   * Books the check could not judge at all, which is a different thing from
   * books it judged and found fine, and the difference is the whole of #356: a
   * check that quietly sets 181 of 238 books aside answers an empty list, and an
   * empty list reads as "everything is fine". So the count is drawn whenever it
   * is not zero, above the list rather than under it.
   */
  const unjudged = notChecked(review)

  /** The book somebody came back from, marked so the run opens on it. */
  const marked = arrivedWith.current?.bookId ?? 0

  /*
   * The piece the last board was on, so a heading is drawn where it changes
   * rather than over every board. The **piece**, not what the piece is called:
   * two pieces standing on one number read the same and are two pieces, and a
   * comparison of the words would draw them as one (#447).
   */
  let piece: number | null = null

  return (
    <Frame
      tab="library"
      top={
        <TopBar
          title="Your shelves"
          sub={counts ? `${plural(range === 'fiction' ? counts.fiction : counts.nonfiction, 'book')} on this run` : undefined}
          onBack={onBack}
        />
      }
    >
      {/*
        One row above the books, which is the row every screen that lists books
        wears. It leads with the run rather than with tags, because this screen
        is not narrowed by tags and never was: fiction and non-fiction are two
        separate arrangements of furniture here, not two words a book carries.
        The circle at the end of it is the same one the library has, and it is
        what replaced the floating strip of three pills that used to sit over
        the bottom of this screen.
      */}
      <Filter look={look} onLook={setLook}>
        <Segmented
          label="Which run of shelves"
          on={range}
          onPick={(next) => { setMoves([]); setRange(next) }}
          options={[
            { value: 'fiction', word: `Fiction${counts ? ` (${counts.fiction})` : ''}` },
            {
              value: 'nonfiction',
              word: `Non-fiction${counts ? ` (${counts.nonfiction})` : ''}`,
            },
          ]}
        />
      </Filter>

      <Trouble said={error} />

      {/* Louder than a hint, and above the list rather than below it, because
          it is the one line that says the list underneath is not the whole
          answer. Nothing here is actionable book by book: what is missing is
          furniture, so it says so and says how many books are behind it. */}
      {!loading && unjudged.count > 0 && (
        <Card kind="Not checked" title={saidBooks(unjudged.count)}>
          <Said>{unjudged.said}</Said>
        </Card>
      )}

      {/* The re-shelving list. Locations are descriptive, so the catalogue can
          only report the disagreement; closing it is a walk to the shelf. */}
      {misfiles.length > 0 && (
        <Misfiled
          misfiles={misfiles}
          review={review}
          moving={moving}
          onOpen={open}
          onMoved={confirmMoved}
          onTakeBack={takeBack}
        />
      )}

      {/* Said out loud rather than left as a silent exclusion: a book nobody
          has ever confirmed onto a shelf cannot be in the wrong place. */}
      {!loading && unplaced > 0 && (
        <Said>
          {unplaced} book{unplaced === 1 ? ' has' : 's have'} never been confirmed
          onto a bookcase, so {unplaced === 1 ? 'it is' : 'they are'} left out of the
          list above.
        </Said>
      )}

      {off.length > 0 && (
        <div className="offshelf">
          <p className="wf-heading wf-heading--flush">Checked out ({off.length})</p>
          {/* What happens to a book that is not on the bookcase depends on
              what is being drawn, so this says which. The list files it into
              its alphabetical place and says so instead of a place; the two
              pictures of the furniture leave it out, because it is not in the
              room. */}
          <Said>
            {look === 'list'
              ? 'Filed into the list below in their alphabetical place, saying so '
                + 'where the place would be: you cannot count along to a book that '
                + 'is not there. '
              : 'Not drawn below, because they are not on the bookcase: the run '
                + 'has closed up behind each one, exactly as it has in the room. '}
            Open one to check it in.
          </Said>
          <List label="Books off the bookcase">
            {off.map(({ book, label }) => (
              <Row
                key={book.id}
                title={book.title}
                sub={filedAs(book) || book.title}
                cloth={clothFor(book.id)}
                photo={coverArt(book, 160)}
                meta={`belongs at ${label}`}
                onPress={() => open(book.id)}
              />
            ))}
          </List>
        </div>
      )}

      {/* The physical consequence of a boundary change, which is the part that
          is easy to lose track of. Nothing here has moved: each line is a walk
          somebody has to make. */}
      {moves.length > 0 && (
        <div className="tomove">
          <Card
            kind="What that costs"
            title={`${plural(moves.length, 'book')} to move`}
            foot={<Button tone="quiet" small onPress={() => setMoves([])}>Dismiss</Button>}
          >
            <Said>Nothing has moved. Dismiss this once they have.</Said>
            <List label="Books to move">
              {moves.map((move) => (
                <Row
                  key={move.id}
                  title={move.title ?? `#${move.id}`}
                  sub={`${move.from} to ${move.to}`}
                  cloth={clothFor(move.id)}
                  onward={false}
                />
              ))}
            </List>
          </Card>
        </div>
      )}

      {loading && <Said>Loading...</Said>}
      {!loading && groups.length === 0 && (
        <Nothing said="Nothing catalogued in this range yet." />
      )}

      {/*
        Areas and the lines between them as one sequence, ordered by
        `libraryRows` rather than by where this file puts a div.

        A boundary belongs to the area it opens, so its line is drawn above
        that area's heading and its Remove deletes that area's boundary. Both
        halves come off the same row, which is the point: they used to be
        decided in two places and disagreed by one (#145).
      */}
      {libraryRows(groups).map((row) => {
        if (row.row === 'divider') {
          return (
            /* A line, not a card. It was a quiet card with the notice as its
               title and Remove in its foot, and at 414 wide that is two hundred
               pixels of dashed outline between two areas that are eighty each:
               the thing separating the shelves was louder than the shelves.
               Found by looking at it. */
            <div
              className="divider"
              key={`divider-${row.separatorId}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <div style={{ flex: 1 }}><Said>{row.notice}</Said></div>
              <Button tone="quiet" small onPress={() => removeSeparator(row.separatorId)}>
                Remove
              </Button>
            </div>
          )
        }

        const group = row.group
        const missing = missingFrom(group, off)
        /* Counted, not concatenated. "1 books" was on this screen before it was
           converted and survived the first cut of the conversion; `plural` is
           what every other count in the app goes through. */
        const note = `${plural(group.books.length, 'book')}${missing > 0 ? `, ${missing} off` : ''}`
        /* The piece the area is on, named once where it changes rather than over
           every row: `2A` and `2B` are two planks of one bookcase, and the
           drawing says "Bookcase 2" once above them. It comes off the board's
           own `standing` through `pieceSaid`, which every furniture screen uses,
           so a crate reads "Crate 5" and something somebody has called the hall
           shelf reads "Hall shelf" (#447). */
        const heading = group.standing && group.standing.fixtureId !== piece
          ? pieceOn(group.standing)
          : null
        piece = group.standing?.fixtureId ?? null

        return (
          /* Keyed on the area, because that is what makes this one board and not
             two: two pieces standing on one number draw the same label, and a
             board's place in the page shifts under it as later pages arrive.

             The label is on the section as well as on the board, because the
             boundary line above it is found by stepping back one element from
             this section and nothing else on the page carries the plank whole
             in an attribute. */
          <section
            key={group.areaId ?? `at-${group.shelf}-${group.area}`}
            className="shelfgroup"
            data-label={group.label}
          >
            {heading && <p className="wf-heading">{heading}</p>}

            {/* The area itself, drawn whichever way was asked for. Everything
                above and below this is the same in all three. */}

            {/* One run of spines, scrolled sideways and never wrapped. Tap one
                to open it, and the cat is on the one you came back from. */}
            {look === 'spines' && (
              <div className="wf-bleed">
                <Shelf
                  label={group.label}
                  note={note}
                  items={group.books.map(({ book }): ShelfItem => ({
                    kind: 'spine',
                    text: filedAs(book) || book.title,
                    name: spineLabel(spineOf(book)),
                    cloth: clothFor(book.id),
                    pages: pagesOf(book),
                    photo: spineArt(book, 160),
                    here: book.id === marked,
                    onPress: () => open(book.id),
                  }))}
                />
              </div>
            )}

            {/* A line per book, and the one thing the list does that neither
                picture of the furniture can: a book somebody has taken away is
                filed into its alphabetical place and says so. A spine row and a
                grid of covers are pictures of a bookcase and a book that is out
                of the house is not in the picture; a line of text is not a
                picture.

                **No plank on the rows.** Every row in this card is the plank the
                card is titled with, so a column of ten identical labels is the
                same fact eleven times and it buries the one row that differs.
                The library's list says a place per row because there every row
                is a different one. Found by looking at it. */}
            {look === 'list' && (
              <Card kind={note} title={group.label}>
                <List label={`Area ${group.label}`}>
                  {listOf(group, off).map(({ book, here }) => (
                    <Row
                      key={book.id}
                      title={book.title}
                      sub={filedAs(book) || book.title}
                      cloth={clothFor(book.id)}
                      photo={coverArt(book, 160)}
                      meta={here ? undefined : 'Checked out'}
                      onward={false}
                      onPress={() => open(book.id)}
                    />
                  ))}
                </List>
              </Card>
            )}

            {/* The same run, laid out face up and allowed to wrap. */}
            {look === 'covers' && (
              <Card kind={note} title={group.label}>
                <Covers
                  label={`Area ${group.label}, ${plural(group.books.length, 'book')}`}
                  items={group.books.map(({ book }): CoverItem => ({
                    id: book.id,
                    title: book.title,
                    author: filedAs(book) || book.title,
                    cloth: clothFor(book.id),
                    photo: coverArt(book, 320),
                    /* What the tile is showing where that is not a front cover
                       of this copy, said in words. It was a dashed border and a
                       corner note; a fact about a picture belongs in the line
                       under it. */
                    meta: coverNote(coverOf(book)) || undefined,
                  }))}
                  onPress={(item) => open(Number(item.id))}
                />
              </Card>
            )}
          </section>
        )
      })}

      {/* Whole-run surgery, kept off the areas themselves and at the foot,
          which is where the drawing puts a way onward: moving a stretch of
          books is a decision about the furniture rather than about any book on
          it, so it does not belong beside a spine one mistap away.

          The word "run" is one this code says and this interface does not,
          which `design.test.tsx` pins on every screen in the gallery. */}
      {onArrange && groups.length > 0 && (
        <div className="wf-under">
          <Button tone="quiet" onPress={() => onArrange(range)}>
            Move all the {range === 'fiction' ? 'fiction' : 'non-fiction'} to another bookcase
          </Button>
        </div>
      )}

      {/* Not "see the bookcases": what it opens is every piece in the room and
          two of them may be a crate and a desk. The category word goes neutral
          even though each piece is named for what it is. */}
      {onFurniture && (
        <div className="wf-under">
          <Button tone="quiet" onPress={onFurniture}>See your fixtures</Button>
        </div>
      )}

      {/* The same dialog an area is removed through on the furniture screen and
          on a book's own page, because it is the same act reached from a third
          door (#456). Its title is the cost said about their books, which is
          what #281 settled and what the other two already say; the sentence
          under it adds what happens next rather than repeating the title, and
          the rows are the labels that read differently afterwards. */}
      {going && (
        <Sure
          /* The area is named rather than said as "its", which is what the
             area's own page can afford: this dialog covers a page of shelves
             and there is nothing on it for a pronoun to point at. */
          title={going.cost.books === 0
            ? `No books stand in ${going.cost.area}`
            : `${going.cost.area} goes, and its ${plural(going.cost.books, 'book')} `
              + `${going.cost.books === 1 ? 'joins' : 'join'} ${going.cost.into}`}
          said={going.cost.books === 0
            ? 'The area comes off the furniture and nothing has to be refiled.'
            : 'Nothing is carried for you. Afterwards the list of books needing '
              + 'attention names each one, and you confirm it where it stands, '
              + 'because only somebody in front of a book can say it has moved.'}
          becomes={going.cost.becomes}
          act="Remove it"
          onAct={() => removeSeparator(going.id, true)}
          onKeep={() => setGoing(null)}
        />
      )}
    </Frame>
  )
}

/**
 * The books whose recorded place and the order's answer disagree.
 *
 * Split out and holding no state, so what it says can be held to a claim in a
 * test rather than only looked at. That is the same reason `Planned` is split
 * out of `MoveRunPane` and `MovesSoFar` out of `ShelveView`, and this is the
 * list that has most earned it: #358 found it silently excluding 181 of 238
 * books, and #196 found its one-way answer trapping somebody who mistapped.
 *
 * One card per book, which is the arrangement the book's own page already uses
 * for the same disagreement (`MisfileNotice`), with the same sentence in it. Two
 * spellings of one fact is how they get to disagree.
 */
export function Misfiled({
  misfiles, review, moving, onOpen, onMoved, onTakeBack,
}: {
  misfiles: Misfile[]
  review: ShelvingReviewResponse | null
  /** The book a write is in flight for, or zero. */
  moving: number
  onOpen: (id: number) => void
  onMoved: (misfile: Misfile) => void
  onTakeBack: (misfile: Misfile) => void
}) {
  return (
    <div className="attention">
      <p className="wf-heading wf-heading--flush">
        Needs attention ({misfiles.length})
      </p>
      {/*
        The instruction over the list names the one answer every row has (#433).

        It named both, and "Undo the move" is on the rows the app made a move
        for and on no others, which is not a rendering to fix: a book pushed onto
        the next plank by a newcomer has no assignment behind it, and moving the
        boundary to close that would be a new decision about the furniture made
        on somebody's behalf wearing the word undo. `docs/shelving.md` settles it
        under "Taking the move back is not the opposite move". So the promise
        went to the rows that can keep it, one line under each, and the button
        did not move at all.
      */}
      <Said>
        Where each book was last seen, against where the order now puts it.
        Nothing has been changed for you. Tap "Moved it" once the book is
        actually there.
      </Said>

      {misfiles.map((misfile) => {
        const busy = moving === misfile.book.id
        /* Drawn only where the app made the move, so the two kinds of entry
           stay tellable apart at a glance. */
        const undoable = canTakeBack(review, misfile.book.id)

        return (
          <div className="attention__row" key={misfile.book.id}>
            <Card
              foot={
                <>
                  <Button tone="secondary" small off={busy} onPress={() => onMoved(misfile)}>
                    {busy ? '...' : 'Moved it'}
                  </Button>
                  {undoable && (
                    <Button tone="quiet" small off={busy} onPress={() => onTakeBack(misfile)}>
                      {busy ? '...' : 'Undo the move'}
                    </Button>
                  )}
                </>
              }
            >
              <List label={misfile.book.title}>
                <Row
                  title={misfile.book.title}
                  sub={
                    bestKnownAuthor(misfile.book.authorFiling, misfile.book.authors)
                    || 'unknown author'
                  }
                  cloth={clothFor(misfile.book.id)}
                  place={misfile.to}
                  onPress={() => onOpen(misfile.book.id)}
                />
              </List>
              <Said>
                Last seen on {misfile.from}. The order now puts it on{' '}
                <strong>{misfile.to}</strong>.
                {undoable
                  && ' The app made this move and nobody has picked the book up,'
                    + ' so "Undo the move" puts it back.'}
              </Said>
              {/*
                Under the sentence rather than instead of it, because both ends
                really do read `1B` and the person is standing in front of two
                planks that say so. The carry screen has drawn this since #447
                and this list did not, which is how a renumbered bookcase (#491)
                could put five rows in front of somebody each saying to carry a
                book from a plank to itself.
              */}
              {misfile.sharedNumber !== null && (
                <Said>{sharedSaid(misfile.from, misfile.sharedNumber)}</Said>
              )}
            </Card>
          </div>
        )
      })}
    </div>
  )
}
