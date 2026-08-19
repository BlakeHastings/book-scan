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
 * The state a waiting book is in, as one word on one pill.
 *
 * The same four words the control above the list filters by, so a book found
 * under "Stuck" says "Stuck" on itself. `failed` is `Stuck` here and nothing
 * more: what is actually wrong with it is a different fact and gets its own
 * pill, which is `whatItNeeds` below and is the whole of #148.
 *
 * **`pending` is the one word that turned into two** (#436), and the control
 * above still holds both under "Reading": what that word answers is which
 * statuses a book can be in, and the row answers something the status cannot,
 * which is whether the worker is on this book right now. See `WAITING_LABEL`.
 */
const STATE_LABEL: Record<CaptureStatus, string> = {
  pending: 'Reading photos',
  ready: 'Identified',
  done: 'Shelved',
  failed: 'Stuck',
}

/**
 * What a waiting book says when nothing is reading it (#436).
 *
 * `pending` was one word over two situations. A book the worker has in its
 * hands is being read and will be done in seconds; a book behind it is waiting
 * for its turn, and a whole queue of them with nothing at the front is a queue
 * that has stopped. Eight of those said "Reading photos" for five minutes.
 *
 * **It is not a third state and it is not a fault.** Nothing is wrong with a
 * book that is waiting to be read, which is exactly why it must not be dressed
 * as one: a capture that could not be read already has its own word, its own
 * diagnosis pill and its own retry (#299, #339), and printing that over a book
 * whose photographs nobody has opened sends somebody to fetch a book that never
 * needed them.
 */
const WAITING_LABEL = 'Waiting to be read'

/**
 * Which of those, for one book.
 *
 * `reading` is the capture the server says its worker is holding, which is what
 * tells a book being read from a book waiting for one. Null, or an id that is
 * not this book's, means nothing is reading this: null because the worker is
 * idle, and a different id because it is busy with somebody else's book.
 */
export function stateWord(capture: Capture, reading?: number | null): string {
  if (capture.status === 'pending' && capture.id !== reading) return WAITING_LABEL
  return STATE_LABEL[capture.status]
}

/**
 * What this row says the book needs, and nothing where nothing is wrong.
 *
 * `failed` used to read "needs you", which was true and useless: the same
 * three words whether the photographs yielded no ISBN, yielded a good one no
 * catalogue has, or broke the read outright. Those need different things from
 * the person holding the book, so the row names which one, out of the same
 * helper Home counts with (#148). One rule, so the row and the first screen
 * cannot say different things about the same capture again.
 *
 * **It is a pill now rather than a line, and that changes nothing about which
 * words it says.** The owner asked for the diagnosis to be a tag rather than a
 * sentence; the four words behind it are `FAILURE_LABEL` and are untouched,
 * because the incident this exists to prevent is somebody being sent to retype
 * an ISBN that read perfectly well.
 */
export function whatItNeeds(capture: Capture): string {
  return capture.status === 'failed' ? FAILURE_LABEL[failureOf(capture)] : ''
}

/**
 * The device that has this book, with no words wrapped around it.
 *
 * > Instead of "checked by" and then the device, just have the device there as
 * > a pill.
 *
 * The claim first, because a claim is somebody working on this book right now
 * and an edit is somebody who was. The row used to say both, in two clauses
 * either side of a middle dot, and tell them apart with "worked on" against
 * "checked": three sentences of prose for one name.
 */
export function deviceOn(capture: Capture): string {
  return capture.claimed_by || capture.edited_by || ''
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

/**
 * Which books the queue is showing.
 *
 * The three the drawing names, and they are the three states a capture is
 * actually in: read and waiting for somebody, still being read, and stuck.
 * "Processing", not "Reading": the owner read the old word as the app telling
 * him he was in the middle of a novel rather than as it working on a
 * photograph.
 */
export type Which = 'ready' | 'processing' | 'stuck' | 'all'

/**
 * Whether a capture belongs under each answer, one predicate each.
 *
 * A table rather than a chain of conditionals inside the filter, and exported
 * rather than closed over, so what each word on that control claims to show is
 * a thing a test can ask about directly. Every status appears under exactly one
 * of the three besides `all`, which is what makes the counts on the control add
 * up to the number in the top bar.
 */
export const SHOWING: Record<Which, (capture: Capture) => boolean> = {
  all: () => true,
  // `done` is a book that has been shelved and whose row has not gone yet.
  // Nothing is wrong with it and nobody is reading it, so it sits with the
  // ones somebody could act on rather than inventing a fourth answer.
  ready: (capture) => capture.status === 'ready' || capture.status === 'done',
  processing: (capture) => capture.status === 'pending',
  stuck: (capture) => capture.status === 'failed',
}

/**
 * The stuck books whose photographs are worth putting through the reader again
 * (#299).
 *
 * The two failures that say nothing about the book: the reader was given up on,
 * or it broke on the way to a verdict. Offered here, above the list, rather than
 * on each row, because the useful case is a reader that stopped and took
 * everything queued behind it with it, which is several books at once and one
 * decision about all of them. The other two failures want a person and a book
 * in their hands, and a button that re-read those would be a button that
 * produces the same answer twice.
 */
export function readableAgain(captures: Capture[]): Capture[] {
  return captures.filter(couldBeReadAgain)
}

interface Props {
  onOpen: (capture: Capture, anchor: QueueReturnAnchor) => void
  onCounts: (counts: QueueCounts) => void
  /** Where each of the four places goes, since this screen wears the tab bar. */
  tabs: Record<TabName, () => void>
  /** Photograph a book, which is what an empty queue is for. */
  onPhotograph: () => void
  /**
   * Set when this mount is a return trip: the user opened a capture from
   * here to shelve it and has come back. Used once, to land the list near
   * where they left off, then reported back as consumed.
   */
  returnAnchor?: QueueReturnAnchor | null
  onReturnAnchorConsumed?: () => void
  /**
   * Which books to open on, where whatever opened this screen was about some of
   * them rather than all of them (#436).
   *
   * The first screen's counts are the reason it exists. "31 stuck" opened this
   * screen on "All 39", so pressing a number about thirty-one books produced a
   * list of thirty-nine, and **a count is a promise about what you will see**.
   * Absent means the whole queue, which is what the tab bar asks for and what
   * somebody working through a pile wants.
   *
   * Used once, on the way in, and then the control above the list owns it: this
   * is where the screen opens, not a filter it is held to.
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
 *
 * **What it draws is `Queued`, which is the wireframe's own row** (#363). The
 * book, the name, and three pills; and nothing on it is a sentence about the
 * book any more. What is left here is the wrapper: the swipe, the word revealed
 * behind it, and the undo that takes the row's place. Those are this screen's
 * and the drawing has none of them.
 */
export function QueueRow({
  capture, held, reading, onOpen, onUndo, gesture, registerRow,
}: RowProps) {
  // What anybody has worked out about this book, over what the worker
  // read off its photographs. The row has to show the corrected title,
  // not the one the wrong ISBN produced, or the person coming to shelve
  // it is looking for the wrong book.
  const draft = draftFromCapture(capture)
  // A capture is not a book: it has no catalogue id and often no title at all,
  // so what OCR read off the cover names the row, and the number names the
  // ones it could not read either. Marked as a guess where it is one: the row
  // has to say which book it is without that name looking like a settled one.
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
        /*
         * The row does not vanish when it is discarded. It stays exactly where
         * the thumb just was and counts down, because the failure this is
         * guarding against is somebody not noticing they discarded anything,
         * and a row that disappears is the one shape that cannot be noticed.
         */
        <div className="queue__undo">
          <span className="queue__undo-text">
            Discarding <strong>{name.text}</strong> and its {photoCount(capture)} photo
            {photoCount(capture) === 1 ? '' : 's'}. Nothing has been deleted yet.
          </span>
          {/* The design system's button, which is what every other way back in
              the app is. It is the primary thing here because taking a discard
              back is the only thing this row is for while the window is open. */}
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
          {/* Revealed as the row slides off it, so what the gesture is going
              to do is legible before the finger lifts. */}
          <span className="queue__behind" aria-hidden="true">Discard</span>

          <div className="queue__slide" {...gesture}>
            <button
              type="button"
              /*
               * `wf-qrow` is the card a waiting book sits on, which the
               * gallery draws and which this screen used to redraw. What is
               * left beside it is the swipe: `queue__open` is the row being
               * unavailable while its photographs are still being read, and
               * the two wrappers outside carry the clip, the reveal and the
               * slide. `library.css` says the same from the other end.
               */
              className="queue__open wf-qrow"
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
              {/*
                The wireframe's row, called rather than rebuilt. The pills are
                its, the book is `Shots` in the mode a book's own page draws
                itself in, and the words are the ones in `Queue.tsx`.

                Three things the row used to print are deliberately not passed.
                What OCR read off the cover is gone, which the owner asked for
                outright. The worker's note under a stuck book is gone with it:
                it says which photograph and which digits, which is a paragraph
                on a row and is already the first thing the screen behind this
                one says when the book is opened. And "worked on by" against
                "checked by" is one device name now.
              */}
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
export function QueuePane({
  onOpen, onCounts, tabs, onPhotograph, returnAnchor, onReturnAnchorConsumed,
  showing,
}: Props) {
  const [captures, setCaptures] = useState<Capture[]>([])
  /*
   * Where the screen opens, which is whatever sent somebody here (#436). A
   * fresh mount per visit, so the initial value is read once and the control
   * above the list owns it from then on: coming in on "Stuck" and pressing
   * "All" shows all of them, and leaving and coming back through the tab bar
   * opens on the whole queue again.
   */
  const [which, setWhich] = useState<Which>(showing ?? 'all')
  /**
   * The capture the server's worker has in its hands, or null.
   *
   * Read from the same answer the list comes from, so it is as fresh as the
   * rows are and stale in exactly the same way. Null covers both "the worker is
   * idle" and "this server did not say", and the row then says a book is
   * waiting rather than being read, which is the safe direction to be wrong in:
   * it claims less.
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
    /*
     * Only poll while there is something to wait for, which is what makes this
     * a wait rather than a poll: it starts when a book is unread and stops when
     * none is.
     *
     * **It is also what keeps the server looking** (#436). A read that finds
     * pending work arms the server's own sweep, so a person standing on this
     * screen watching a queue that has stopped is the thing that starts it
     * again, within a couple of seconds and without touching anything.
     */
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

  const registerRow = useCallback((id: number, element: HTMLDivElement | null) => {
    if (element) rows.current.set(id, element)
    else rows.current.delete(id)
  }, [])

  const searching = query.trim().length > 0

  const failed = captures.filter(SHOWING.stuck)
  const rereadable = readableAgain(captures)

  /**
   * Send the stuck-through-no-fault-of-their-own ones back through the reader.
   *
   * One request each rather than a bulk route: each capture is its own row and
   * its own refusal, and a book that somebody shelved from another phone while
   * this screen was open should not stop the others going back. `allSettled`
   * for the same reason, and the count of what actually went is what is
   * reported rather than what was asked for.
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
      {/*
        Which ones. Four answers where the drawing has three, because the
        drawing shows the queue mid-sort and the app opens on it: everything,
        which is what somebody working through a pile is looking at, and then
        the three the drawing names.
      */}
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

      {/*
        The way back from a reader that stopped, without going and finding the
        books again (#299).

        It used to live inside a card that summarised what the stuck books
        need, and #349 took that summary off: the count is on the first screen
        and on the control above this, and what each book needs is on the book.
        The button was never part of the summary. It is one decision about
        several books at once, so it stays above the list it acts on, saying in
        its own words how many it would send.

        **Secondary now, and that came out of looking at it.** Inside the card
        it was the primary thing in a box about stuck books. Standing on the
        screen it was a full-width filled button above everything, which claims
        to be what this screen is for, and this screen is for picking a book up
        and shelving it. The design system is explicit that a screen has at
        most one primary and that it is the one thing the screen is for.
      */}
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

      {/*
        The row above the books, which is the library's row with this screen's
        search box in front of it (#349).

        **Without the switcher that used to end it** (#363). It chose between
        the front and the spine because a row drew one small photograph of a
        book; a row draws the book now, spine standing against the front, so
        both of its answers produce the same picture. The row itself is the same
        component the library wears and is otherwise untouched.

        **And the box in front of it is the design system's too** (#387), which
        is the same `SearchField` the find screen and the tag panel type into
        and the same one `#/design/queue` draws with this screen's own
        placeholder. It was the app's box wearing the design system's tokens: a
        second field that agreed with the drawing until one of them was edited.

        **The Clear button went with it, and it is not lost.** The design
        system keeps the browser's own clear affordance and takes it down to
        the ink around it rather than hiding it, which is the whole of
        `.wf-search__input::-webkit-search-cancel-button`; and this screen
        already had a second way out, which is "Show the whole queue" below,
        offered at the exact moment a search stops matching anything. Two
        controls that do one thing is the fault the row itself was built to
        end.
      */}
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
          {/*
            The way back to the whole queue, which was a word underlined inside
            that sentence. It is the quiet button now, which is what this design
            system does with a word that is really a control: the same 44px the
            rest of the app is built to, on the screen most likely to be used
            one-handed with a book in the other.
          */}
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

      {/* The gallery's own list of waiting books, called rather than rebuilt.
          A list of divs rather than a `ul`, which is what the drawing is and
          what stops a second set of rules existing to undo a `ul`'s bullets
          and indent. */}
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
