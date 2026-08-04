import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, type BookRow, type CheckedOutAt, type Counts, type Misfile, type Move,
  type ShelfGroupDto, type ShelvingReview,
} from '../lib/api'
import { missingFrom, rowOf } from '../lib/shelfRow'
import {
  LIBRARY_VIEWS, rememberedView, rememberView, VIEW_DESCRIPTION, VIEW_LABEL,
  type LibraryView,
} from '../lib/libraryView'
import { SpineRow } from './ShelfStrip'
import { ShelfList } from './ShelfList'
import { CoverGrid } from './CoverGrid'
import { areaLabel } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

/**
 * Where the library was when a book was opened from it, so coming back lands
 * there rather than at the top of the first bookcase.
 *
 * Both axes, because this view now has two. The page scroll says which area
 * you were looking at; the book says where along that area's row you were,
 * and it is stored as an id rather than a pixel offset so the row can have
 * moved underneath you and still land in the right place.
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
}

/**
 * The shelves as they physically are, rather than one flat list.
 *
 * Three drawings of the same books, in the same order, grouped the same way,
 * and the person picks (#82). Only the middle of each area changes:
 *
 *   - the spine row, one horizontal run per area, which is what you see
 *     standing in front of the bookcase, and which never wraps because a break
 *     in a run means "a new area" everywhere else here (#81);
 *   - the list, a line per book, which is what this was before the rows;
 *   - the gallery, a grid of covers, which is allowed to wrap precisely
 *     because it is not pretending to be a photograph of the furniture.
 *
 * Everything around them is shared: the misfiles, the books off the bookcase
 * and the separators are facts about the shelves, not about how they are
 * drawn.
 *
 * A boundary move is not offered here at all (#96). It is one book's own
 * business, so it lives on that book's page, only when the book is genuinely
 * at an edge; a control drawn into every area, in three different drawings,
 * is one mistap away from moving a book nobody meant to touch.
 *
 * The button at the end of the last shelf is how the software learns
 * something it cannot see: that the shelf is full. From then on a book
 * inserted earlier in the alphabet pushes the last one along, and the moves
 * that causes are reported rather than left for you to discover at the shelf.
 */
export function ShelfView({
  onOpen, returnAnchor, onReturnAnchorConsumed,
}: Props) {
  // A return trip opens on the range it left from, or the tab would change
  // under the person while they were away.
  const [range, setRange] = useState<ShelfRange>(returnAnchor?.range ?? 'fiction')
  /*
   * Read from storage rather than from a prop, because this component is
   * unmounted the moment a book opens and so cannot remember anything itself,
   * and because the answer has to survive a reload as well as a navigation.
   */
  const [view, setView] = useState<LibraryView>(rememberedView)
  const [groups, setGroups] = useState<ShelfGroupDto[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [counts, setCounts] = useState<Counts | null>(null)
  const [off, setOff] = useState<CheckedOutAt[]>([])
  const [review, setReview] = useState<ShelvingReview | null>(null)
  const [moving, setMoving] = useState(0)
  const spines = useRef(new Map<number, HTMLElement>())
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
  // A fresh mount every time the library is shown (App only renders it while
  // mode === 'library'), so this only needs to fire once per visit.
  const restored = useRef(false)

  /*
   * Both tallies, not just this tab's. A non-fiction book saved while the
   * library sits on Fiction is invisible with no hint it exists, which reads
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
   * for the place you had already found. The page scroll goes back first, and
   * then the book that was opened is brought into view along its own row;
   * `block: 'nearest'` means that second step does not undo the first, since
   * by then the row is already where it was.
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
    spines.current.get(anchor.bookId)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
    onReturnAnchorConsumed?.()
  }, [groups, loading, onReturnAnchorConsumed])

  /** Open a book, remembering enough to come back to this exact spot. */
  const open = (id: number) =>
    onOpen(id, { range, bookId: id, scrollY: window.scrollY })

  /** Change the drawing, and write the choice down so it outlives this mount. */
  const chooseView = (next: LibraryView) => {
    setView(next)
    rememberView(next)
  }

  /**
   * The person says they have carried this book to where it belongs.
   *
   * Nothing here decides that on their behalf. The list is a report, and a
   * book stays on it until somebody has actually been to the shelf, because
   * writing the answer we would like to be true would destroy the only record
   * of where the book really is.
   */
  const confirmMoved = async (misfile: Misfile) => {
    setMoving(misfile.book.id)
    setError('')
    try {
      await api.setLocation(misfile.book.id, misfile.to)
      load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setMoving(0)
    }
  }

  const misfiles = review?.misfiles ?? []
  const unplaced = (review?.excluded ?? [])
    .filter((entry) => entry.reason === 'never-placed').length

  const removeSeparator = async (id: number) => {
    setError('')
    try {
      const result = await api.removeSeparator(id, range)
      setGroups(result.groups)
      setMoves(result.moves)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const title = (book: BookRow) => book.author_filing || book.authors || book.title

  return (
    <main className="main main--library">
      <div className="segmented">
        <button
          className={range === 'fiction' ? 'seg seg--on' : 'seg'}
          onClick={() => { setMoves([]); setRange('fiction') }}
        >
          Fiction{counts ? ` (${counts.fiction})` : ''}
        </button>
        <button
          className={range === 'nonfiction' ? 'seg seg--on' : 'seg'}
          onClick={() => { setMoves([]); setRange('nonfiction') }}
        >
          Non-fiction{counts ? ` (${counts.nonfiction})` : ''}
        </button>
      </div>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {/* The re-shelving list. Locations are descriptive, so the catalogue can
          only report the disagreement; closing it is a walk to the shelf. */}
      {misfiles.length > 0 && (
        <section className="attention">
          <h3 className="attention__head">Needs attention ({misfiles.length})</h3>
          <p className="hint">
            Where each book was last seen, against where the order now puts it.
            Nothing has been changed for you. Tap "Moved it" once the book is
            actually there.
          </p>
          {misfiles.map((misfile) => (
            <div key={misfile.book.id} className="attention__row">
              <button
                className="attention__body"
                onClick={() => open(misfile.book.id)}
              >
                <span className="attention__title">{misfile.book.title}</span>
                <span className="attention__where">
                  {misfile.book.authorFiling || 'unknown author'}
                  {' · '}
                  {misfile.from} → <strong>{misfile.to}</strong>
                </span>
              </button>
              <button
                className="btn btn--ghost"
                disabled={moving === misfile.book.id}
                onClick={() => confirmMoved(misfile)}
              >
                {moving === misfile.book.id ? '...' : 'Moved it'}
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Said out loud rather than left as a silent exclusion: a book nobody
          has ever confirmed onto a shelf cannot be in the wrong place. */}
      {!loading && unplaced > 0 && (
        <p className="hint">
          {unplaced} book{unplaced === 1 ? ' has' : 's have'} never been confirmed
          onto a bookcase, so {unplaced === 1 ? 'it is' : 'they are'} left out of the
          list above.
        </p>
      )}

      {off.length > 0 && (
        <section className="offshelf">
          <h3 className="offshelf__head">
            Checked out ({off.length})
          </h3>
          {/* What happens to a book that is not on the bookcase depends on
              what is being drawn, so this says which. The list files it into
              its alphabetical place with a dash where the position would be;
              the two pictures of the furniture leave it out, because it is
              not in the room. */}
          <p className="hint">
            {view === 'list'
              ? 'Filed into the list below in their alphabetical place, with a '
                + 'dash where the position would be: you cannot count along to '
                + 'a book that is not there. '
              : 'Not drawn below, because they are not on the bookcase: the run '
                + 'has closed up behind each one, exactly as it has in the room. '}
            Open one to check it in.
          </p>
          {off.map(({ book, label }) => (
            <button key={book.id} className="offshelf__row" onClick={() => open(book.id)}>
              <span className="offshelf__title">{book.title}</span>
              <span className="offshelf__author">{title(book)} · belongs at {label}</span>
            </button>
          ))}
        </section>
      )}

      {/* The physical consequence of the change, which is the part that is
          easy to lose track of. */}
      {moves.length > 0 && (
        <div className="moves" onClick={() => setMoves([])}>
          <strong>{moves.length} book{moves.length === 1 ? '' : 's'} to move</strong>
          <ul>
            {moves.map((move) => (
              <li key={move.id}>
                {move.title ?? `#${move.id}`}: {move.from} to <strong>{move.to}</strong>
              </li>
            ))}
          </ul>
          <span className="hint">Tap to dismiss once they are moved.</span>
        </div>
      )}

      {loading && <p className="hint">Loading...</p>}
      {!loading && groups.length === 0 && (
        <p className="hint">Nothing catalogued in this range yet.</p>
      )}

      {groups.map((group) => {
        const missing = missingFrom(group.label, off)

        return (
          /* The label is on the section as well as spelled out in the header,
             because the header spells it as two halves ("Bookcase 1", "Area
             A") and nothing else on the page carries "1A" whole. */
          <section key={group.label} className="shelfgroup" data-label={group.label}>
            <header className="shelfgroup__head">
              {/* Spelled out rather than left as "A2": the bookcase number is
                  the half people actually need when walking to the book. */}
              <span className="shelfgroup__label">Bookcase {group.shelf}</span>
              <span className="shelfgroup__shelf">Area {areaLabel(group.area)}</span>
              <span className="shelfgroup__count">
                {group.books.length} books
                {missing > 0 ? `, ${missing} off` : ''}
              </span>
            </header>

            {/* The area itself, drawn whichever way was asked for. Everything
                above and below this is the same in all three. */}

            {/* One run of spines, scrolled sideways and never wrapped, with
                the number under each book being what you count along to find
                it. Tap one to open it. */}
            {view === 'shelf' && (
              <SpineRow
                books={rowOf(group)}
                label={group.label}
                onOpen={open}
                registerSpine={(id, element) => {
                  if (element) spines.current.set(id, element)
                  else spines.current.delete(id)
                }}
              />
            )}

            {view === 'list' && (
              <ShelfList group={group} checkedOut={off} onOpen={open} />
            )}

            {/* The same run, laid out face up and allowed to wrap. */}
            {view === 'gallery' && (
              <CoverGrid
                books={group.books.map((entry) => entry.book)}
                label={group.label}
                onOpen={open}
              />
            )}

            {group.separatorId !== null && (
              <div className="divider">
                <span className="divider__label">
                  {group.kind === 'shelf' ? 'New bookcase starts here' : 'New area starts here'}
                </span>
                <button
                  className="btn btn--ghost"
                  onClick={() => removeSeparator(group.separatorId!)}
                >
                  Remove
                </button>
              </div>
            )}
          </section>
        )
      })}

      {/*
        Which drawing you get, put where a thumb already is.
        Fixed to the bottom of the viewport rather than laid out at the top
        with the Fiction/Non-fiction tabs: this is a phone held in one hand,
        the top corners are the part of the screen a thumb cannot reach, and a
        second row up there would also cost every view a strip of the height
        it is trying to fill. Floating it costs the page nothing but the
        padding below, which only the very last row ever notices.
      */}
      <nav className="viewswitch" aria-label="How to draw the library">
        {LIBRARY_VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            className={view === option ? 'viewswitch__opt viewswitch__opt--on' : 'viewswitch__opt'}
            aria-pressed={view === option}
            aria-label={VIEW_DESCRIPTION[option]}
            onClick={() => chooseView(option)}
          >
            {VIEW_LABEL[option]}
          </button>
        ))}
      </nav>
    </main>
  )
}
