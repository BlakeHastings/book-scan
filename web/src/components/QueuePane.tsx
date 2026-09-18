import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  api, captureName, deviceName, draftFromCapture,
  type Capture, type CaptureStatus, type QueueCounts,
} from '../lib/api'
import { newestFirst } from '../lib/queueOrder'
import { filterQueue } from '../lib/queueSearch'
import { shotsOf } from '../lib/queuePhoto'
import {
  beginSwipe, moveSwipe, swipeArmed, type Swipe,
} from '../lib/swipe'
import { createDiscardWindow, UNDO_WINDOW_MS } from '../lib/discardWindow'
import {
  couldBeReadAgain, FAILURE_LABEL, failureOf,
} from '../../shared/captureFailure'
import { Nothing, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Segmented } from '../design/Controls'
import { Filter, SearchField } from '../design/Finding'
import { Phone } from '../design/Phone'
import { Queued } from '../design/Queue'
import { Trouble } from './RoomFrame'

/**
 * `failed` is `Stuck` here and nothing more; what is actually wrong with it
 * is a separate pill, `whatItNeeds` below.
 */
const STATE_LABEL: Record<CaptureStatus, string> = {
  pending: 'Reading photos',
  ready: 'Identified',
  done: 'Shelved',
  failed: 'Stuck',
}

/**
 * Not a third state and not a fault: a book waiting for its turn is not the
 * same as one being read, but nothing is wrong with either of them, so this
 * must not be dressed up as a failure.
 */
const WAITING_LABEL = 'Waiting to be read'

/**
 * `reading` is null when the worker is idle, or an id belonging to a
 * different capture when it is busy elsewhere; either way this book is not
 * currently being read.
 */
export function stateWord(capture: Capture, reading?: number | null): string {
  if (capture.status === 'pending' && capture.id !== reading) return WAITING_LABEL
  return STATE_LABEL[capture.status]
}

/** Only failed captures need something named; the words come from `FAILURE_LABEL`. */
export function whatItNeeds(capture: Capture): string {
  return capture.status === 'failed' ? FAILURE_LABEL[failureOf(capture)] : ''
}

/** The claim wins over the edit: a claim is somebody working the book right now. */
export function deviceOn(capture: Capture): string {
  return capture.claimed_by || capture.edited_by || ''
}

/**
 * A capture still being read cannot be shelved: there is nothing yet to
 * confirm, correct or place.
 */
export function canShelve(capture: Capture): boolean {
  return capture.status !== 'pending'
}

/** Where in the displayed list a capture sat when the user opened it. */
export interface QueueReturnAnchor {
  id: number
  index: number
}

export type Which = 'ready' | 'processing' | 'stuck' | 'all'

/** Every status belongs under exactly one of these three besides `all`. */
export const SHOWING: Record<Which, (capture: Capture) => boolean> = {
  all: () => true,
  // `done` also counts as ready: it is shelved but its row has not gone yet.
  ready: (capture) => capture.status === 'ready' || capture.status === 'done',
  processing: (capture) => capture.status === 'pending',
  stuck: (capture) => capture.status === 'failed',
}

/**
 * Only the two failures that say nothing about the book (the reader gave up,
 * or broke outright). The other two need a person with the book in hand, and
 * re-reading them would just produce the same answer again.
 */
export function readableAgain(captures: Capture[]): Capture[] {
  return captures.filter(couldBeReadAgain)
}

interface Props {
  onOpen: (capture: Capture, anchor: QueueReturnAnchor) => void
  onCounts: (counts: QueueCounts) => void
  tabs: Record<TabName, () => void>
  onPhotograph: () => void
  /**
   * Set when this mount is a return trip: the user opened a capture from
   * here to shelve it and has come back. Used once, to land the list near
   * where they left off, then reported back as consumed.
   */
  returnAnchor?: QueueReturnAnchor | null
  onReturnAnchorConsumed?: () => void
  /**
   * Which books to open on. Absent means the whole queue. Used once, on the
   * way in; the control above the list owns the filter after that.
   */
  showing?: Which | null
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
  /** True while this capture's discard is being held open, undoable. */
  held: boolean
  /** The capture the server's worker is holding, so a row can say which. */
  reading: number | null
  onOpen: (capture: Capture) => void
  onUndo: (id: number) => void
  gesture: RowGesture
  registerRow: (id: number, element: HTMLDivElement | null) => void
}

/** How many photographs go with a capture, which is what a discard destroys. */
export function photoCount(capture: Capture): number {
  return [capture.front_image, capture.back_image, capture.edge_image]
    .filter(Boolean).length
}

/**
 * Holds no state of its own: the swipe lives in the pane, which paints the
 * drag straight onto the DOM rather than through React, so dragging a row
 * does not re-render a list that can be a hundred books long.
 */
export function QueueRow({
  capture, held, reading, onOpen, onUndo, gesture, registerRow,
}: RowProps) {
  // Shows the corrected draft, not the raw OCR title, so the person shelving
  // sees the same title as the person who fixed it.
  const draft = draftFromCapture(capture)
  // A capture is not a book yet, so this may be a guess; marked as one via
  // `guessed` where it is.
  const name = captureName(capture)
  const shelvable = canShelve(capture)

  return (
    <div
      ref={(el) => registerRow(capture.id, el)}
      role="listitem"
      className={
        `queue__row queue__row--${capture.status}${held ? ' queue__row--going' : ''}`
      }
    >
      {held ? (
        // Stays in place and counts down rather than vanishing, so a
        // discard is not easy to miss.
        <div className="queue__undo">
          <span className="queue__undo-text">
            Discarding <strong>{name.text}</strong> and its {photoCount(capture)} photo
            {photoCount(capture) === 1 ? '' : 's'}. Nothing has been deleted yet.
          </span>
          <Button tone="primary" onPress={() => onUndo(capture.id)}>
            Undo
          </Button>
          <span
            className="queue__undo-bar"
            style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }}
            aria-hidden="true"
          />
        </div>
      ) : (
        <>
          <span className="queue__behind" aria-hidden="true">Discard</span>

          <div className="queue__slide" {...gesture}>
            <button
              type="button"
              // `library.css` styles this from the other side; keep the two in sync.
              className="queue__open wf-qrow"
              // `aria-disabled` rather than `disabled`: a disabled button
              // swallows the pointer events the swipe is made of in every
              // browser this runs on.
              aria-disabled={!shelvable}
              onClick={() => { if (shelvable) onOpen(capture) }}
            >
              <Queued
                name={name.text}
                guessed={name.guessed}
                sub={draft.authors || draft.isbn13}
                shots={shotsOf(capture)}
                state={stateWord(capture, reading)}
                wants={whatItNeeds(capture)}
                device={deviceOn(capture)}
              />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Polls while anything is still being read, so a capture's status updates
 * without a manual refresh, and so a second person's work appears here too.
 * What a discard does is deferred rather than confirmed; see
 * `discardWindow.ts` for why that is the safer of the two.
 */
export function QueuePane({
  onOpen, onCounts, tabs, onPhotograph, returnAnchor, onReturnAnchorConsumed,
  showing,
}: Props) {
  const [captures, setCaptures] = useState<Capture[]>([])
  // Read once on mount; the control above the list owns it after that, so
  // returning via the tab bar always reopens on the whole queue.
  const [which, setWhich] = useState<Which>(showing ?? 'all')
  /**
   * The capture the server's worker has in its hands, or null.
   *
   * Null covers both "the worker is idle" and "this server did not say", and
   * either way the row says a book is waiting rather than being read, which
   * is the safe direction to be wrong in.
   */
  const [reading, setReading] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const me = deviceName()
  const [query, setQuery] = useState('')
  /** Ids whose discard is being held open, mirrored out of the window below. */
  const [held, setHeld] = useState<number[]>([])
  /** True while the stuck books are being sent back through the reader. */
  const [rereading, setRereading] = useState(false)
  const rows = useRef(new Map<number, HTMLDivElement>())
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
        setReading(result.reading ?? null)
        onCounts(result.counts)
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false))
  }, [onCounts])

  useEffect(() => {
    load()
  }, [load])

  // Kept in a ref rather than rebuilt each render: the window owns live
  // timers that a rebuild would strand, deleting something already undone.
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

  // Navigating away mid-window keeps the book rather than deleting it; see
  // `discardWindow.ts` for why that is the direction to fail in.
  const window_ = discards.current
  useEffect(() => () => window_.abandon(), [window_])

  const anyPending = captures.some((c) => c.status === 'pending')

  useEffect(() => {
    // Polls only while something is pending, and a read that finds pending
    // work re-arms the server's own sweep.
    if (!anyPending) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [anyPending, load])

  // A capture that left the queue some other way while held (deleted or
  // shelved elsewhere) has nothing left to take back, so release its timer
  // rather than firing a delete at a stale id.
  useEffect(() => {
    if (held.length === 0 || loading) return
    const present = new Set(captures.map((c) => c.id))
    const gone = held.filter((id) => !present.has(id))
    if (gone.length === 0) return
    for (const id of gone) window_.release(id)
    setHeld((current) => current.filter((id) => present.has(id)))
  }, [captures, held, loading, window_])

  // A held discard stays visible regardless of the filter, since its undo
  // is the only way back and a filter that hid it would not stop the delete.
  const visible = useMemo(() => {
    const matching = filterQueue(captures, query).filter(SHOWING[which])
    if (held.length === 0) return matching
    const shown = new Set(matching.map((c) => c.id))
    return captures.filter((c) => shown.has(c.id) || held.includes(c.id))
  }, [captures, query, held, which])

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

    // The book wins over the filter: if an active search hides the target,
    // the query is cleared instead of landing on nothing.
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

  // Dragging paints straight onto the row's own style, so a finger moving
  // down a long list re-renders nothing until the gesture ends.
  const drag = useRef<{ id: number; pointer: number; swipe: Swipe } | null>(null)
  // A pointerup after a sideways drag is still followed by a click; without
  // this, letting go of a half-finished swipe opens the book.
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

  const registerRow = useCallback((id: number, element: HTMLDivElement | null) => {
    if (element) rows.current.set(id, element)
    else rows.current.delete(id)
  }, [])

  const searching = query.trim().length > 0

  const failed = captures.filter(SHOWING.stuck)
  const rereadable = readableAgain(captures)

  /**
   * One request per capture rather than a bulk route, so a book shelved
   * elsewhere mid-batch does not stop the others going back; the count
   * reported is what actually succeeded, not what was asked for.
   */
  const readAgain = async () => {
    setError('')
    setNotice('')
    setRereading(true)
    try {
      const results = await Promise.allSettled(
        rereadable.map((capture) => api.readCaptureAgain(capture.id)),
      )
      const sent = results.filter((result) => result.status === 'fulfilled').length
      const refused = results.length - sent
      setNotice(
        `${sent === 1 ? 'Reading it' : `Reading ${sent} of them`} again.`
        + (refused ? ` ${refused} had already left the queue.` : ''),
      )
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setRereading(false)
      load()
    }
  }

  const counted = (word: string, n: number) => (n > 0 ? `${word} ${n}` : word)

  return (
    <div className="wf">
      <Phone
        tab="queue"
        onTab={(name) => tabs[name]()}
        top={
          <TopBar
            title="Queue"
            sub={
              loading
                ? undefined
                : captures.length === 1
                  ? 'One book on the table'
                  : `${captures.length} books on the table`
            }
          />
        }
      >
      {captures.length > 0 && (
        <Segmented
          label="Which ones"
          on={which}
          onPick={setWhich}
          options={[
            { value: 'all', word: counted('All', captures.length) },
            { value: 'ready', word: counted('Ready', captures.filter(SHOWING.ready).length) },
            { value: 'processing', word: counted('Reading', captures.filter(SHOWING.processing).length) },
            { value: 'stuck', word: counted('Stuck', failed.length) },
          ]}
        />
      )}

      {rereadable.length > 0 && (
        <Button
          tone="secondary"
          block
          off={rereading}
          onPress={() => { void readAgain() }}
        >
          {rereading
            ? 'Sending them back...'
            : rereadable.length === 1
              ? 'Read its photos again'
              : `Read those ${rereadable.length} books' photos again`}
        </Button>
      )}

      <div className="queue__tools">
        <Filter>
          <SearchField
            typed={query}
            onType={setQuery}
            placeholder="Search by title or author"
            label="Search the queue by title or author"
          />
        </Filter>
      </div>

      <Trouble said={error} />
      {notice && <Said>{notice}</Said>}
      {loading && <Said>Loading...</Said>}

      {!loading && captures.length === 0 && (
        <>
          <Nothing said="Even the cat couldn't find anything to knock off the table." />
          <Button tone="primary" block onPress={onPhotograph}>
            Open the camera
          </Button>
        </>
      )}

      {!loading && captures.length > 0 && searching && (
        <>
          <Said>
            {visible.length} of {captures.length} shown.
            {visible.length === 0 && ' Nothing here matches that.'}
          </Said>
          {visible.length === 0 && (
            <Button tone="quiet" onPress={() => setQuery('')}>
              Show the whole queue
            </Button>
          )}
        </>
      )}

      {!loading && captures.length > 0 && !searching && visible.length === 0 && (
        <Said>Nothing in the queue is in that state.</Said>
      )}

      {!loading && visible.length > 0 && !searching && (
        <Said>Tap a book to shelve it. Slide one left to discard it.</Said>
      )}

      <div className="wf-qlist" role="list" aria-label="Books on the table">
        {visible.map((capture) => (
          <QueueRow
            key={capture.id}
            capture={capture}
            held={held.includes(capture.id)}
            reading={reading}
            onOpen={openRow}
            onUndo={undoDiscard}
            gesture={gestureFor(capture)}
            registerRow={registerRow}
          />
        ))}
      </div>
      </Phone>
    </div>
  )
}
