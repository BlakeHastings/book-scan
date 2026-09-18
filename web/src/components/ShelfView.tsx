import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, Refusal, type AreaGoing, type CheckedOutAt, type Counts, type DriftingBook,
  type Misfile, type Move, type ShelfGroupDto, type ShelvingReviewResponse,
} from '../lib/api'
import { driftOnShelves } from '../lib/driftWords'
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
 * Both axes: the page scroll says which area you were looking at, and the
 * book (stored as an id, not a pixel offset, so the row can move underneath
 * you) says where along that area's row you were. The horizontal half is
 * restored by `Shelf` itself, which marks the given book and brings it into
 * the run.
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
  /** The only way through to the furniture screen. */
  onFurniture?: () => void
}

export function ShelfView({
  onOpen, returnAnchor, onReturnAnchorConsumed, onBack, onArrange, onFurniture,
}: Props) {
  // A return trip opens on the range it left from, or the tab would change
  // under the person while they were away.
  const [range, setRange] = useState<ShelfRange>(returnAnchor?.range ?? 'fiction')
  // Same storage key the library screen reads: a person who chooses covers
  // on one of the two screens that draw every book they own has not chosen
  // it on only one of them.
  const { look, setLook } = useBrowsing()
  const [groups, setGroups] = useState<ShelfGroupDto[]>([])
  /**
   * Null when no rule says where the plank begins; undefined until a read
   * has answered. Three states rather than two: an empty screen can mean
   * nothing catalogued here yet, a read still in flight, or a range no rule
   * places at all (in which case the books are still there, but the
   * furniture has nothing to say about them).
   */
  const [begins, setBegins] = useState<string | null | undefined>(undefined)
  const [moves, setMoves] = useState<Move[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [counts, setCounts] = useState<Counts | null>(null)
  const [off, setOff] = useState<CheckedOutAt[]>([])
  const [review, setReview] = useState<ShelvingReviewResponse | null>(null)
  // Not part of `Promise.all` below and not able to fail this screen: a
  // check that could not answer must not take the shelves down with it.
  const [drift, setDrift] = useState<{ books: DriftingBook[]; total: number } | null>(null)
  const [moving, setMoving] = useState(0)
  /*
   * The line somebody has pressed Remove on and has not yet answered about,
   * with what the server said it would cost. Null the rest of the time, which
   * is every moment nothing is being asked.
   */
  const [going, setGoing] = useState<{ id: number; cost: AreaGoing } | null>(null)
  // Read from the prop once, on the first render, and never again: watching
  // the prop live would catch the anchor this same visit records when
  // opening a book, treating an in-progress visit as a return trip.
  const arrivedWith = useRef(returnAnchor ?? null)
  // A fresh mount every time the shelves are shown, so this only needs to fire
  // once per visit.
  const restored = useRef(false)

  // Both tallies, not just this tab's, so a book saved to the other run is
  // not invisible with no hint it exists.
  useEffect(() => {
    api.health().then((h) => setCounts(h.counts)).catch(() => {})
  }, [groups])

  const load = useCallback(() => {
    setLoading(true)
    // Asked again on every reload, not once per visit: removing a boundary
    // here changes the areas, which is one of the two things the check
    // compares, so a stale card would report a state just changed.
    api.drift().then(setDrift).catch(() => setDrift(null))
    Promise.all([api.shelves(range), api.misfiles(range)])
      .then(([shelves, flagged]) => {
        setGroups(shelves.groups)
        setOff(shelves.checkedOut)
        setReview(flagged)
        setBegins(shelves.begins)
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false))
  }, [range])

  useEffect(() => { load() }, [load])

  /**
   * The vertical half of the restore; `Shelf` handles the horizontal half.
   * Runs after `Shelf`'s effect, since a child's effects fire before its
   * parent's, so the page lands where the person left it rather than
   * wherever bringing one spine into view put it.
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
   * `recordMoved` sends the plank rather than the row's label: this list is
   * drawn once and acted on minutes later, and a label is a rendering that
   * reads differently the moment somebody names the piece it is on.
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
   * Withdraws an assignment nobody acted on, and writes no location at all,
   * since nothing about the room has changed.
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
   * The first press is a question, never the act: the server refuses a
   * removal nobody has been asked about and hands back what it would cost,
   * so this asks with that answer rather than with anything worked out here,
   * and the second press (`theAreaGoes`) is the confirmation.
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
  // Books the check could not judge at all, which is different from books
  // it judged and found fine: an empty list would otherwise read as
  // "everything is fine" even when the check excluded some silently.
  const unjudged = notChecked(review)

  /** The book somebody came back from, marked so the run opens on it. */
  const marked = arrivedWith.current?.bookId ?? 0

  /**
   * Null rather than nought when the count has not arrived: a number nobody
   * answered with, on a card about books somebody is worried they have
   * lost, is the one thing that card must not invent.
   */
  const rangeCount = counts
    ? (range === 'fiction' ? counts.fiction : counts.nonfiction)
    : null

  // The piece itself, not its label: two pieces standing on one number read
  // the same, and comparing the words would draw them as one.
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
      {/* Leads with the run rather than with tags: this screen is not
          narrowed by tags, since fiction and non-fiction are two separate
          arrangements of furniture here, not two words a book carries. */}
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

      {/* Above the misfile list: everything below is written on the
          assumption that where a book was last seen and where the order
          puts it now are both readings this check has not flagged as
          unreliable. Drawn with the whole collection's count regardless of
          which run is on screen; see `driftOnShelves`. */}
      {drift && drift.total > 0 && <Drifted drift={drift} onOpen={open} />}

      {!loading && unjudged.count > 0 && (
        <Card kind="Not checked" title={saidBooks(unjudged.count)}>
          <Said>{unjudged.said}</Said>
        </Card>
      )}

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
        <NothingDrawn range={range} begins={begins} filed={rangeCount} />
      )}

      {/* A boundary belongs to the area it opens: its line is drawn above
          that area's heading, and its Remove deletes that area's boundary. */}
      {libraryRows(groups).map((row) => {
        if (row.row === 'divider') {
          return (
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
        const note = `${plural(group.books.length, 'book')}${missing > 0 ? `, ${missing} off` : ''}`
        // Named once where the piece changes, not over every row: `2A` and
        // `2B` are two planks of one bookcase, so the drawing says
        // "Bookcase 2" once above them.
        const heading = group.standing && group.standing.fixtureId !== piece
          ? pieceOn(group.standing)
          : null
        piece = group.standing?.fixtureId ?? null

        return (
          // Keyed on the area, not the label: two pieces standing on one
          // number draw the same label, and a board's place in the page
          // shifts under it as later pages arrive.
          <section
            key={group.areaId ?? `at-${group.shelf}-${group.area}`}
            className="shelfgroup"
            data-label={group.label}
          >
            {heading && <p className="wf-heading">{heading}</p>}

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

            {/* No plank on the rows: every row in this card is already the
                plank the card is titled with, so repeating it here would
                bury the one row that differs (`meta` says "Checked out"
                instead). */}
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
                    meta: coverNote(coverOf(book)) || undefined,
                  }))}
                  onPress={(item) => open(Number(item.id))}
                />
              </Card>
            )}
          </section>
        )
      })}

      {/* Kept at the foot rather than beside the areas: moving a stretch of
          books is a decision about the furniture, not about any one book,
          so it does not belong beside a spine one mistap away. */}
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

      {going && (
        <Sure
          // The area is named rather than said as "its": this dialog covers
          // a page of shelves, and there is nothing on it for a pronoun to
          // point at.
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
 * Two different empty states, not one: a range whose rule has just been
 * taken off still holds every book it held a minute ago, and saying only
 * "Nothing catalogued in this range yet" would be false of it. `begins`
 * tells them apart: undefined until a read has come back, null when no
 * rule places the range, and the plank the run opens at otherwise.
 */
export function NothingDrawn({
  range, begins, filed,
}: {
  range: ShelfRange
  /** Where the run opens, null when nothing says, undefined until a read says. */
  begins: string | null | undefined
  /** How many books are filed in this range, or null while nobody has said. */
  filed: number | null
}) {
  if (begins !== null) return <Nothing said="Nothing catalogued in this range yet." />

  const named = range === 'fiction' ? 'fiction' : 'non-fiction'

  return (
    <Card kind="Nowhere to draw" title={`Nothing says where ${named} begins`}>
      <p>
        No rule points {named} at a bookcase or a shelf, so there is no run to
        draw and no plank to put a book on.{' '}
        {filed === null
          ? 'Nothing has been changed.'
          : filed === 1
            ? 'The one book filed here is still catalogued and has not moved.'
            : `The ${filed} books filed here are still catalogued and have not moved.`}{' '}
        Describe the room and say what belongs where, and this fills in.
      </p>
    </Card>
  )
}

/**
 * Split out and holding no state, so what it says can be held to a claim in
 * a test rather than only looked at.
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
      {/* "Undo the move" is on the rows the app made a move for and on no
          others: a book pushed onto the next plank by a newcomer has no
          assignment behind it, and moving the boundary to close that would
          be a new decision wearing the word undo. See `docs/shelving.md`. */}
      <Said>
        Where each book was last seen, against where the order now puts it.
        Nothing has been changed for you. Tap "Moved it" once the book is
        actually there.
      </Said>

      {misfiles.map((misfile) => {
        const busy = moving === misfile.book.id
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
              {/* Under the sentence rather than instead of it: both ends
                  really do read the same label, e.g. after a bookcase is
                  renumbered, and the person is standing in front of two
                  planks that say so. */}
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

/**
 * Offers nothing to press, deliberately: repairing a disagreement destroys
 * the evidence of how it happened, and a stable broken state is what makes
 * one diagnosable weeks later. A row opens the book and does nothing else,
 * the same as every other list of books in this app.
 *
 * Split out and holding no state, like `Misfiled` above, so what it says
 * can be held to a claim in a test rather than only looked at.
 */
export function Drifted({
  drift, onOpen,
}: {
  drift: { books: DriftingBook[]; total: number }
  onOpen: (id: number) => void
}) {
  const said = driftOnShelves(drift.total)
  // Bounded by the screen rather than by the wire: the worst case is a
  // rule somebody switched off, putting the whole collection on this list.
  // The count in the title is never truncated.
  const shown = drift.books.slice(0, 25)
  const rest = drift.total - shown.length

  return (
    <div className="drifted">
      <Card kind="Not agreed" title={said.title}>
        <Said>{said.said}</Said>
        <List label="Books drawn in one place and claimed by another">
          {shown.map((one) => (
            <Row
              key={one.bookId}
              title={one.title}
              // A book no rule claims at all also reaches this list and has
              // only one of the two answers, so it says that rather than
              // drawing an empty place.
              sub={one.fromRules
                ? `drawn in ${one.fromLayout}, claimed into ${one.fromRules}`
                : `drawn in ${one.fromLayout}, and no rule claims it`}
              cloth={clothFor(one.bookId)}
              onPress={() => onOpen(one.bookId)}
            />
          ))}
        </List>
        {rest > 0 && (
          <Said>
            And {plural(rest, 'more book')}, not named here: a list this long is
            a rule that has stopped claiming a whole stretch of the collection
            rather than a handful of books to go and look at.
          </Said>
        )}
      </Card>
    </div>
  )
}
