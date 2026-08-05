import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  api, deviceName, draftFromCapture, editsOn,
  type Capture, type QueueCounts,
} from '../lib/api'
import { newestFirst } from '../lib/queueOrder'
import { filterQueue } from '../lib/queueSearch'
import {
  PHOTO_DESCRIPTION, PHOTO_LABEL, QUEUE_PHOTOS, queueThumb, rememberedPhoto,
  rememberPhoto, type QueuePhoto,
} from '../lib/queuePhoto'
import {
  beginSwipe, moveSwipe, swipeArmed, type Swipe,
} from '../lib/swipe'
import { createDiscardWindow, UNDO_WINDOW_MS } from '../lib/discardWindow'
import { coverUrl } from './PlacementCard'

const STATUS_LABEL: Record<string, string> = {
  pending: 'reading photos',
  ready: 'identified',
  failed: 'needs you',
  done: 'shelved',
}

/**
 * A capture still being read cannot be shelved: there is nothing yet to
 * confirm, correct or place. The row says so, and now that the row itself is
 * the control, this is what stops a tap on one starting anything.
 */
export function canShelve(capture: Capture): boolean {
  return capture.status !== 'pending'
}

/** Where in the displayed list a capture sat when the user opened it. */
export interface QueueReturnAnchor {
  id: number
  index: number
}

interface Props {
  onOpen: (capture: Capture, anchor: QueueReturnAnchor) => void
  onCounts: (counts: QueueCounts) => void
  /**
   * Set when this mount is a return trip: the user opened a capture from
   * here to shelve it and has come back. Used once, to land the list near
   * where they left off, then reported back as consumed.
   */
  returnAnchor?: QueueReturnAnchor | null
  onReturnAnchorConsumed?: () => void
}

/** The four pointer handlers a row needs, kept together so it takes one prop. */
export interface RowGesture {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

interface RowProps {
  capture: Capture
  photo: QueuePhoto
  me: string
  /** True while this capture's discard is being held open, undoable. */
  held: boolean
  onOpen: (capture: Capture) => void
  onUndo: (id: number) => void
  gesture: RowGesture
  registerRow: (id: number, element: HTMLLIElement | null) => void
}

/** How many photographs go with a capture, which is what a discard destroys. */
export function photoCount(capture: Capture): number {
  return [capture.front_image, capture.back_image, capture.edge_image]
    .filter(Boolean).length
}

/**
 * One book waiting to be filed.
 *
 * Holds no state of its own, deliberately: the swipe lives in the pane, which
 * paints the drag straight onto the DOM rather than through React, so dragging
 * a row does not re-render a list that can be a hundred books long. That also
 * leaves this callable as the plain function it is, which is how it gets
 * tested in a project with no browser in its test setup.
 *
 * The whole row is the control now (#120). It used to carry a "Shelve" button
 * and a "Discard" button in a column on the right, which is two taps of aim
 * for somebody holding a book in their other hand.
 */
export function QueueRow({
  capture, photo, me, held, onOpen, onUndo, gesture, registerRow,
}: RowProps) {
  // What anybody has worked out about this book, over what the worker
  // read off its photographs. The row has to show the corrected title,
  // not the one the wrong ISBN produced, or the person coming to shelve
  // it is looking for the wrong book.
  const draft = draftFromCapture(capture)
  const heldByOther = capture.claimed_by && capture.claimed_by !== me
  // Two different facts, and the queue's value is telling them apart:
  // nobody has been near this book, or somebody has and this is where
  // they got to.
  const stated = Object.keys(editsOn(capture)).length > 0
  const looked = capture.edited_at
    ? `${stated ? 'worked on' : 'checked'} by ${capture.edited_by || 'someone'}`
    : ''
  const thumb = queueThumb(capture, photo)
  // A capture is not a book: it has no catalogue id and no title until a
  // lookup resolves, so the number it was given at the camera stands in.
  const title = draft.title || `Book #${capture.id}`
  const shelvable = canShelve(capture)

  return (
    <li
      ref={(el) => registerRow(capture.id, el)}
      className={
        `queue__row queue__row--${capture.status}${held ? ' queue__row--going' : ''}`
      }
    >
      {held ? (
        /*
         * The row does not vanish when it is discarded. It stays exactly where
         * the thumb just was and counts down, because the failure this is
         * guarding against is somebody not noticing they discarded anything,
         * and a row that disappears is the one shape that cannot be noticed.
         */
        <div className="queue__undo">
          <span className="queue__undo-text">
            Discarding <strong>{title}</strong> and its {photoCount(capture)} photo
            {photoCount(capture) === 1 ? '' : 's'}. Nothing has been deleted yet.
          </span>
          <button
            className="btn btn--primary queue__undo-btn"
            onClick={() => onUndo(capture.id)}
          >
            Undo
          </button>
          <span
            className="queue__undo-bar"
            style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }}
            aria-hidden="true"
          />
        </div>
      ) : (
        <>
          {/* Revealed as the row slides off it, so what the gesture is going
              to do is legible before the finger lifts. */}
          <span className="queue__behind" aria-hidden="true">Discard</span>

          <div className="queue__slide" {...gesture}>
            <button
              type="button"
              className="queue__open"
              /*
               * `aria-disabled` rather than `disabled`. A disabled button
               * swallows pointer events in every browser this runs on, and
               * they are what the swipe is made of: a capture whose photos
               * came out unusable is exactly one somebody wants to discard
               * while it is still being read.
               */
              aria-disabled={!shelvable}
              onClick={() => { if (shelvable) onOpen(capture) }}
            >
              <span className="queue__photo">
                {thumb && <img src={coverUrl(thumb)} alt="" loading="lazy" />}
              </span>

              <span className="queue__body">
                <span className="queue__title">{title}</span>
                <span className="queue__meta">
                  {draft.authors || draft.isbn13 || 'no ISBN yet'}
                </span>
                {!capture.isbn13 && capture.cover_text && (
                  <span className="queue__cover">
                    Cover reads: {capture.cover_text.split('\n').join(' / ')}
                  </span>
                )}
                <span className={`queue__status queue__status--${capture.status}`}>
                  {/* The row used to carry a "Shelve" button that said "..."
                      while a capture was being read. With the button gone this
                      line is the only thing left to say why tapping does
                      nothing, so it says it in words rather than in dots. */}
                  {STATUS_LABEL[capture.status]}{shelvable ? '' : '...'}
                  {heldByOther ? ` · with ${capture.claimed_by}` : ''}
                  {looked ? ` · ${looked}` : ''}
                </span>
                {capture.note && capture.status === 'failed' && (
                  <span className="queue__note">{capture.note}</span>
                )}
              </span>
            </button>
          </div>
        </>
      )}
    </li>
  )
}

/**
 * Books photographed but not yet filed. Polls while anything is still being
 * read, so a capture stops saying "reading photos" without a manual refresh,
 * and so a second person's work appears here too.
 *
 * This is a working surface rather than a report (#120): the row is the
 * control, the front cover is what a book is recognised by while it is in your
 * hands, a sideways drag discards, and a box at the top finds one book in a
 * stack. What a discard does is deferred rather than confirmed; see
 * `discardWindow.ts` for why that is the safer of the two.
 */
export function QueuePane({ onOpen, onCounts, returnAnchor, onReturnAnchorConsumed }: Props) {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const me = deviceName()
  /*
   * Read from storage rather than from a prop, because this pane is unmounted
   * the moment a capture is opened and so cannot remember anything itself, and
   * because the answer has to survive a reload as well as a navigation.
   */
  const [photo, setPhoto] = useState<QueuePhoto>(rememberedPhoto)
  const [query, setQuery] = useState('')
  /** Ids whose discard is being held open, mirrored out of the window below. */
  const [held, setHeld] = useState<number[]>([])
  const rows = useRef(new Map<number, HTMLLIElement>())
  // A fresh mount every time the pane is shown (App only renders it while
  // mode === 'queue'), so this only needs to fire once per visit.
  const restored = useRef(false)

  const load = useCallback(() => {
    api.listCaptures()
      .then((result) => {
        // The server lists oldest first, the order the background worker
        // reads them in. The stack is on top, not the bottom, so newest
        // first is what the display shows.
        setCaptures(newestFirst(result.captures))
        onCounts(result.counts)
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false))
  }, [onCounts])

  useEffect(() => {
    load()
  }, [load])

  /*
   * The delete itself, sent only once a held discard's window has closed with
   * nobody having taken it back.
   *
   * Built once and kept in a ref: the window owns live timers, and rebuilding
   * it on a render would strand them and delete something after the person had
   * already undone it.
   */
  const loadRef = useRef(load)
  loadRef.current = load
  const discards = useRef(createDiscardWindow((id) => {
    setHeld((current) => current.filter((entry) => entry !== id))
    api.deleteCapture(id)
      .then((result) => {
        if (result.photosRemoved === 0) {
          // Its photos are still in use by the book it became, so they stay.
          setNotice(
            'Removed from the queue. Its photos belong to a shelved book, '
            + 'so they were kept.',
          )
        }
        loadRef.current()
      })
      .catch((caught) => {
        setError((caught as Error).message)
        loadRef.current()
      })
  }))

  /*
   * Nothing held survives this pane going away, and nothing held is deleted on
   * the way out. Somebody who navigates away mid-window keeps the book; see
   * `discardWindow.ts` for why that is the direction to fail in.
   */
  const window_ = discards.current
  useEffect(() => () => window_.abandon(), [window_])

  const anyPending = captures.some((c) => c.status === 'pending')

  useEffect(() => {
    // Only poll while there is something to wait for.
    if (!anyPending) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [anyPending, load])

  /*
   * A capture that left the queue some other way while its discard was held:
   * another person deleted it, or shelved it from their own phone. There is
   * nothing left to take back, so let go of the timer rather than firing a
   * delete at an id that has gone.
   */
  useEffect(() => {
    if (held.length === 0 || loading) return
    const present = new Set(captures.map((c) => c.id))
    const gone = held.filter((id) => !present.has(id))
    if (gone.length === 0) return
    for (const id of gone) window_.release(id)
    setHeld((current) => current.filter((id) => present.has(id)))
  }, [captures, held, loading, window_])

  /**
   * The queue, narrowed to what was typed, in the order it already had.
   *
   * A held discard stays on screen whatever is in the search box. Its undo is
   * the only way back, and a filter that hid it would take that away without
   * stopping the delete.
   */
  const visible = useMemo(() => {
    const matching = filterQueue(captures, query)
    if (held.length === 0) return matching
    const shown = new Set(matching.map((c) => c.id))
    return captures.filter((c) => shown.has(c.id) || held.includes(c.id))
  }, [captures, query, held])

  useEffect(() => {
    // Land back near the book just handled instead of leaving the person to
    // scroll for it. Runs once per visit: if the opened capture is still
    // here (shelving was cancelled) scroll to it; if it left the queue
    // (shelving finished) scroll to whatever slid into its place.
    if (restored.current || loading || !returnAnchor) return

    const stillThere = captures.some((c) => c.id === returnAnchor.id)
    const targetId = stillThere
      ? returnAnchor.id
      : captures[Math.min(returnAnchor.index, captures.length - 1)]?.id

    /*
     * The book wins over the filter. Coming back from a capture has to land on
     * that capture, and a search that no longer matches it would otherwise
     * land the person at the top of a list their book is not in. The pane is
     * remounted per visit so the box is normally already empty; this is the
     * case where it is not, and it clears rather than scrolling to nothing.
     */
    if (targetId !== undefined && query && !visible.some((c) => c.id === targetId)) {
      setQuery('')
      return
    }

    restored.current = true
    if (targetId !== undefined) {
      rows.current.get(targetId)?.scrollIntoView({ block: 'center' })
    }
    onReturnAnchorConsumed?.()
  }, [captures, loading, returnAnchor, onReturnAnchorConsumed, query, visible])

  const open = async (capture: Capture) => {
    setError('')
    if (!canShelve(capture)) {
      setNotice('Still reading its photographs. It can be shelved once that finishes.')
      return
    }
    setNotice('')
    try {
      // The index is into the whole queue, not the filtered view, so coming
      // back from a book that has since been shelved lands on its neighbour
      // in the real list rather than in whatever a search left behind.
      const index = captures.findIndex((c) => c.id === capture.id)
      // Claiming is what stops two people filling in the same book.
      const { capture: claimed } = await api.claimCapture(capture.id, me)
      onOpen(claimed, { id: capture.id, index })
    } catch (caught) {
      setError((caught as Error).message)
      load()
    }
  }

  /** Change which photograph is drawn, and write the choice down. */
  const choosePhoto = (next: QueuePhoto) => {
    setPhoto(next)
    rememberPhoto(next)
  }

  /*
   * The gesture, in refs rather than in state.
   *
   * Dragging paints straight onto the row's own style, so a finger moving down
   * a list of a hundred books re-renders nothing. React only hears about the
   * gesture when it ends and something has to change.
   */
  const drag = useRef<{ id: number; pointer: number; swipe: Swipe } | null>(null)
  /*
   * A pointerup after a sideways drag is still followed by a click. Without
   * this, letting go of a half-finished swipe opens the book you were trying
   * not to open.
   */
  const swallowClick = useRef(false)

  const paint = (id: number, swipe: Swipe | null) => {
    const row = rows.current.get(id)
    if (!row) return
    row.style.setProperty('--dx', `${swipe?.dx ?? 0}px`)
    row.dataset.armed = swipe && swipeArmed(swipe) ? 'yes' : 'no'
    row.dataset.dragging = swipe && swipe.axis === 'horizontal' ? 'yes' : 'no'
  }

  const endDrag = (discard: boolean) => {
    const current = drag.current
    drag.current = null
    if (!current) return
    paint(current.id, null)
    if (!discard) return
    const capture = captures.find((c) => c.id === current.id)
    if (capture) startDiscard(capture)
  }

  /**
   * Hold this capture's discard open.
   *
   * Nothing is sent. The row stays on screen counting down, and the request
   * only goes out if the window closes with nobody having taken it back.
   */
  const startDiscard = (capture: Capture) => {
    setError('')
    setNotice('')
    discards.current.hold(capture.id)
    setHeld((current) => (current.includes(capture.id) ? current : [...current, capture.id]))
  }

  const undoDiscard = (id: number) => {
    discards.current.release(id)
    setHeld((current) => current.filter((entry) => entry !== id))
  }

  const gestureFor = (capture: Capture): RowGesture => ({
    onPointerDown: (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      swallowClick.current = false
      drag.current = {
        id: capture.id,
        pointer: event.pointerId,
        swipe: beginSwipe(event.clientX, event.clientY),
      }
    },
    onPointerMove: (event) => {
      const current = drag.current
      if (!current || current.pointer !== event.pointerId) return
      const next = moveSwipe(current.swipe, event.clientX, event.clientY)
      current.swipe = next
      if (next.axis === 'horizontal') swallowClick.current = true
      paint(current.id, next)
    },
    onPointerUp: (event) => {
      const current = drag.current
      if (!current || current.pointer !== event.pointerId) return
      endDrag(swipeArmed(current.swipe))
    },
    // The browser took the gesture over, which on a phone means the list is
    // being scrolled. Nothing sideways happened as far as this row is
    // concerned.
    onPointerCancel: () => endDrag(false),
  })

  const openRow = (capture: Capture) => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    void open(capture)
  }

  const registerRow = useCallback((id: number, element: HTMLLIElement | null) => {
    if (element) rows.current.set(id, element)
    else rows.current.delete(id)
  }, [])

  const searching = query.trim().length > 0

  return (
    <main className="main">
      <h2 className="pane-title">Queue</h2>

      <div className="queue__tools">
        <div className="queue__search">
          <input
            type="search"
            className="queue__search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or author"
            aria-label="Search the queue by title or author"
            autoComplete="off"
          />
          {/* Spelled out rather than left to the keyboard's own clear button,
              which is not there on every phone and is not there at all once
              the keyboard is dismissed. */}
          {searching && (
            <button
              type="button"
              className="queue__search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear the search"
            >
              Clear
            </button>
          )}
        </div>

        {/* Which photograph of the book you are looking at. Front by default:
            a book being worked through is face up in somebody's hands, not
            shelved end on. */}
        <nav className="segmented queue__photoswitch" aria-label="Which photo to show">
          {QUEUE_PHOTOS.map((option) => (
            <button
              key={option}
              type="button"
              className={photo === option ? 'seg seg--on' : 'seg'}
              aria-pressed={photo === option}
              aria-label={PHOTO_DESCRIPTION[option]}
              onClick={() => choosePhoto(option)}
            >
              {PHOTO_LABEL[option]}
            </button>
          ))}
        </nav>
      </div>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {notice && <p className="hint" onClick={() => setNotice('')}>{notice}</p>}
      {loading && <p className="hint">Loading...</p>}

      {!loading && captures.length === 0 && (
        <p className="hint">
          Nothing waiting. Photographed books appear here while they are read.
        </p>
      )}

      {!loading && captures.length > 0 && searching && (
        <p className="hint">
          {visible.length} of {captures.length} shown.
          {visible.length === 0 && ' Nothing here matches that. '}
          {visible.length === 0 && (
            <button type="button" className="linkish" onClick={() => setQuery('')}>
              Show the whole queue
            </button>
          )}
        </p>
      )}

      {!loading && visible.length > 0 && !searching && (
        <p className="hint queue__howto">
          Tap a book to shelve it. Slide one left to discard it.
        </p>
      )}

      <ul className="queue">
        {visible.map((capture) => (
          <QueueRow
            key={capture.id}
            capture={capture}
            photo={photo}
            me={me}
            held={held.includes(capture.id)}
            onOpen={openRow}
            onUndo={undoDiscard}
            gesture={gestureFor(capture)}
            registerRow={registerRow}
          />
        ))}
      </ul>
    </main>
  )
}
