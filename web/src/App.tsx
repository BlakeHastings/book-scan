import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, deviceName, draftFromBook, draftFromLookup, emptyDraft,
  type Capture, type Counts, type Draft, type LookupResponse,
  type PlacementResponse, type QueueCounts,
} from './lib/api'
import {
  captureStill, describeStream, openCamera, SLOT_CROP, SLOT_GUIDE,
  SLOT_GUIDE_LABEL, SLOTS, SLOT_HINT, SLOT_LABEL, SLOT_SHORT, stopStream,
  thumbnail, type Slot,
} from './lib/scanner'
import { filingName } from '../shared/shelving'
import { PlacementCard } from './components/PlacementCard'
import { BookDetail } from './components/BookDetail'
import { ShelfView } from './components/ShelfView'
import { QueuePane } from './components/QueuePane'

type Mode = 'capture' | 'review' | 'library' | 'queue'
type SlotStatus = 'empty' | 'busy' | 'found' | 'none' | 'kept'

/** Next slot with no photo in it, so the shutter advances by itself. */
function nextEmpty(shots: Partial<Record<Slot, string>>, from: Slot): Slot {
  const order = [...SLOTS.slice(SLOTS.indexOf(from) + 1), ...SLOTS]
  return order.find((slot) => !shots[slot]) ?? from
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [mode, setMode] = useState<Mode>('capture')
  const [cameraOn, setCameraOn] = useState(false)
  const [resolution, setResolution] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [shots, setShots] = useState<Partial<Record<Slot, string>>>({})
  const [thumbs, setThumbs] = useState<Partial<Record<Slot, string>>>({})
  const [status, setStatus] = useState<Partial<Record<Slot, SlotStatus>>>({})
  const [activeSlot, setActiveSlot] = useState<Slot>('back')

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [lookup, setLookup] = useState<LookupResponse | null>(null)
  const [identified, setIdentified] = useState(false)
  const [placement, setPlacement] = useState<PlacementResponse | null>(null)
  const [placementStale, setPlacementStale] = useState(false)
  const [savedPlacement, setSavedPlacement] = useState<PlacementResponse | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [relookupBusy, setRelookupBusy] = useState(false)
  const [relookupError, setRelookupError] = useState('')
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [captureId, setCaptureId] = useState<number | null>(null)
  const [bookId, setBookId] = useState<number | null>(null)
  const [deletingBook, setDeletingBook] = useState(false)

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')
  const shotCount = SLOTS.filter((slot) => shots[slot]).length
  const busy = SLOTS.some((slot) => status[slot] === 'busy')
  const fullScreenCamera = mode === 'capture'
  const me = deviceName()

  useEffect(() => {
    api.health().then((h) => setCounts(h.counts)).catch(() => {})
  }, [])

  // The camera view is a fixed overlay, so the document behind it must not
  // scroll or iOS will rubber-band the whole page under the controls.
  useEffect(() => {
    document.body.classList.toggle('body--locked', fullScreenCamera)
    return () => document.body.classList.remove('body--locked')
  }, [fullScreenCamera])

  // -----------------------------------------------------------------------
  // Camera
  // -----------------------------------------------------------------------

  const stopCamera = useCallback(() => {
    stopStream(streamRef.current)
    streamRef.current = null
    setCameraOn(false)
    setResolution('')
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  // getUserMedia needs a user gesture on iOS, so this only runs from a tap.
  const startCamera = async () => {
    setError('')
    try {
      const stream = await openCamera()
      streamRef.current = stream
      setCameraOn(true)
      setResolution(describeStream(stream))
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => {})
      }
    } catch (caught) {
      setError((caught as Error).message)
      stopCamera()
    }
  }

  // -----------------------------------------------------------------------
  // Capture and identify
  // -----------------------------------------------------------------------

  const applyLookup = (result: LookupResponse) => {
    setLookup(result)
    setIdentified(true)
    setDraft((current) => ({
      ...draftFromLookup(result),
      location: current.location,
      notes: current.notes,
    }))
  }

  /**
   * Take the shot, then send it for identification. The photo is kept whether
   * or not an ISBN comes back: all three images are wanted regardless, and a
   * failed read is no reason to throw a photo away.
   */
  /**
   * Take the shot and hand it straight to the queue.
   *
   * Nothing is identified inline any more. The camera used to call a
   * synchronous identify endpoint for feedback and the queue then read the
   * very same image again, so every book paid for the expensive pass twice.
   * Now the queue is the only thing that reads a photo, and the feedback here
   * is a view of its progress.
   */
  const shoot = async () => {
    const video = videoRef.current
    if (!video) return

    const slot = activeSlot
    const full = captureStill(video, { crop: SLOT_CROP[slot] })
    if (!full) {
      setError('The camera has not produced a frame yet. Give it a moment.')
      return
    }

    setThumbs((current) => ({ ...current, [slot]: full }))
    void thumbnail(full).then((small) =>
      setThumbs((current) => ({ ...current, [slot]: small })),
    )
    setStatus((current) => ({ ...current, [slot]: 'busy' }))
    setShots((current) => ({ ...current, [slot]: full }))
    setActiveSlot((current) => nextEmpty({ ...shots, [slot]: full }, current))

    try {
      const { capture, counts } = await api.addPhoto(full, slot, captureId)
      setCaptureId(capture.id)
      setQueueCounts(counts)
    } catch (caught) {
      setStatus((current) => ({ ...current, [slot]: 'none' }))
      setError((caught as Error).message)
    }
  }

  /**
   * Watch the capture the camera is filling, so the chips and the banner
   * reflect what the queue has actually read. Stops once it settles.
   */
  useEffect(() => {
    if (mode !== 'capture' || captureId === null) return

    let cancelled = false
    const tick = async () => {
      try {
        const { capture } = await api.getCapture(captureId)
        if (cancelled) return

        const read = new Set(capture.analysed.split(',').filter(Boolean))
        setStatus((current) => {
          const next = { ...current }
          for (const slot of SLOTS) {
            if (!read.has(slot)) continue
            next[slot] = capture.isbn13 && slot === 'back' ? 'found' : 'kept'
          }
          return next
        })

        if (capture.status === 'ready' && capture.draft_json) {
          const looked = JSON.parse(capture.draft_json) as LookupResponse
          if (looked.found && !identified) applyLookup(looked)
        } else if (capture.status === 'failed' && capture.note) {
          setError(capture.note)
        }
      } catch {
        // A poll failing is not worth interrupting the person scanning.
      }
    }

    void tick()
    const timer = setInterval(tick, 1500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [mode, captureId, identified])

  // -----------------------------------------------------------------------
  // Live placement preview
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (mode !== 'review' || !draft.title.trim()) {
      setPlacement(null)
      return
    }
    setPlacementStale(true)
    const timer = setTimeout(() => {
      api.previewPlacement(draft, bookId ?? undefined)
        .then((result) => {
          setPlacement(result)
          setPlacementStale(false)
          setDraft((current) =>
            current.location ? current : { ...current, location: result.suggestedLocation },
          )
        })
        .catch((caught) => setError((caught as Error).message))
    }, 250)
    return () => clearTimeout(timer)
  }, [
    mode, draft.title, draft.authors, draft.isFiction, draft.seriesName,
    draft.seriesIndex, draft.authorFilingOverride, bookId,
  ])

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /**
   * Replace the ISBN and refetch the record from the catalogue.
   *
   * The ISBN is the key everything else hangs off, so a misread digit makes
   * every other field wrong. Correcting it refetches rather than asking the
   * user to retype the metadata. Location and notes are kept: they are the
   * fields the person, not the catalogue, is the authority on.
   */
  const relookup = async (isbn: string) => {
    setRelookupBusy(true)
    setRelookupError('')
    try {
      const result = await api.lookupIsbn(isbn)
      if (result.found) {
        setLookup(result)
        setIdentified(true)
        setDraft((current) => ({
          ...draftFromLookup(result),
          location: current.location,
          notes: current.notes,
          isbnSource: 'manual',
        }))
      } else {
        // Record the corrected digits even when nothing matches, so the book
        // is not left carrying an ISBN we know to be wrong.
        setDraft((current) => ({
          ...current,
          isbn13: result.isbn13 || isbn.replace(/[^0-9Xx]/g, ''),
          isbn10: result.isbn10 || '',
          isbnSource: 'manual',
        }))
        setError(
          `No catalogue has ${isbn}. The ISBN has been saved; fill the rest in by hand.`,
        )
      }
    } catch (caught) {
      setRelookupError((caught as Error).message)
    } finally {
      setRelookupBusy(false)
    }
  }

  /** Remove a shelved book and the photos nothing else is using. */
  const deleteBook = async () => {
    if (bookId === null) return
    setDeletingBook(true)
    setError('')
    try {
      const result = await api.deleteBook(bookId)
      setCounts(result.counts)
      reset()
      setMode('library')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setDeletingBook(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const result = bookId
        ? await api.updateBook(bookId, draft)
        : await api.saveBook(
            draft, shots, Boolean(draft.authorFilingOverride), captureId ?? undefined,
          )
      setCounts(result.counts)
      // Only the insert path reports queue counts; an edit does not touch it.
      if ('queue' in result) setQueueCounts(result.queue as QueueCounts)
      // The server recomputes placement at save time. With two people
      // scanning, a neighbour can land between preview and save, so the
      // preview we rendered may already be wrong.
      setSavedPlacement(result.placement)
      reset()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Move on. The photos are already with the queue, so this only clears the
   * camera; whatever the queue makes of them shows up in the Queue tab.
   */
  const nextBook = () => {
    if (shotCount === 0 && !captureId) return
    reset()
  }

  /**
   * Open an already-shelved book for editing. Same detail view as a queued
   * capture, so there is one place a book is edited rather than two.
   */
  const openBook = async (id: number) => {
    setError('')
    try {
      const { book } = await api.getBook(id)
      const loaded = draftFromBook(book)
      // A stored filing name that the heuristic would not produce is an
      // override, and must survive the round trip or the book moves on save.
      const derived = filingName(loaded.authors.split(',')[0]?.trim() ?? '')
      setDraft({
        ...loaded,
        authorFilingOverride:
          book.author_filing && book.author_filing !== derived ? book.author_filing : '',
      })
      setBookId(id)
      setCaptureId(null)
      setLookup(null)
      setIdentified(Boolean(book.isbn13))
      setThumbs({
        front: book.front_image ? `/api/covers/${book.front_image}` : undefined,
        back: book.back_image ? `/api/covers/${book.back_image}` : undefined,
        edge: book.edge_image ? `/api/covers/${book.edge_image}` : undefined,
      })
      setShots({})
      setMode('review')
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  /** Open a queue item in the review pane, pre-filled from its lookup. */
  const openCapture = (capture: Capture) => {
    const looked = capture.draft_json
      ? (JSON.parse(capture.draft_json) as LookupResponse)
      : null

    setCaptureId(capture.id)
    setBookId(null)
    setLookup(looked)
    setIdentified(Boolean(looked?.found))
    setDraft(
      looked?.found
        ? draftFromLookup(looked)
        : {
            ...emptyDraft,
            isbn13: capture.isbn13,
            isbn10: capture.isbn10,
            title: capture.title_guess,
            isbnSource: capture.isbn_source,
          },
    )
    setThumbs({
      front: capture.front_image ? `/api/covers/${capture.front_image}` : undefined,
      back: capture.back_image ? `/api/covers/${capture.back_image}` : undefined,
      edge: capture.edge_image ? `/api/covers/${capture.edge_image}` : undefined,
    })
    // The photos already live on the server; do not re-upload them on save.
    setShots({})
    setMode('review')
  }

  const reset = () => {
    if (captureId) void api.releaseCapture(captureId, me).catch(() => {})
    setDraft(emptyDraft)
    setLookup(null)
    setIdentified(false)
    setShots({})
    setThumbs({})
    setStatus({})
    setActiveSlot('back')
    setPlacement(null)
    setCaptureId(null)
    setBookId(null)
    setMode('capture')
  }

  // -----------------------------------------------------------------------
  // Full-screen camera
  // -----------------------------------------------------------------------

  if (fullScreenCamera) {
    return (
      <div className="cam">
        <video ref={videoRef} className="cam__video" playsInline muted autoPlay />

        {cameraOn && (
          <div
            className={SLOT_CROP[activeSlot] ? 'cam__guide cam__guide--crop' : 'cam__guide'}
            style={{
              left: `${SLOT_GUIDE[activeSlot].x * 100}%`,
              top: `${SLOT_GUIDE[activeSlot].y * 100}%`,
              width: `${SLOT_GUIDE[activeSlot].width * 100}%`,
              height: `${SLOT_GUIDE[activeSlot].height * 100}%`,
            }}
          >
            <span className="cam__guide-label">{SLOT_GUIDE_LABEL[activeSlot]}</span>
          </div>
        )}

        <div className="cam__top">
          <button className="cam__chip-btn" onClick={() => { stopCamera(); setMode('library') }}>
            Library
          </button>
          <button className="cam__chip-btn" onClick={() => { stopCamera(); setMode('queue') }}>
            Queue
            {queueCounts && queueCounts.pending + queueCounts.ready + queueCounts.failed > 0 && (
              <span className="cam__badge">
                {queueCounts.pending + queueCounts.ready + queueCounts.failed}
              </span>
            )}
          </button>
          <span className="cam__meta">
            {counts ? `${counts.total} shelved` : ''}
            {resolution ? ` · ${resolution}` : ''}
          </span>
          {(shotCount > 0 || identified) && (
            <button className="cam__chip-btn" onClick={reset}>Start over</button>
          )}
        </div>

        {/* The instruction from the last saved book, so it survives the walk
            to the shelf and back for the next scan. */}
        {savedPlacement && (
          <div className="cam__placement" onClick={() => setSavedPlacement(null)}>
            <span className="cam__placement-label">Last book</span>
            {savedPlacement.instruction}
          </div>
        )}

        {error && <div className="cam__error" onClick={() => setError('')}>{error}</div>}

        {!cameraOn && (
          <div className="cam__idle">
            <h2>Photograph the book</h2>
            <p>Back cover first, for the barcode. Then the front, then the spine.</p>
            <button className="btn btn--primary btn--big" onClick={startCamera}>
              Start camera
            </button>
          </div>
        )}

        <div className="cam__bottom">
          {identified && (
            <div className="cam__found">
              <strong>{draft.title}</strong>
              {draft.authors ? ` · ${draft.authors}` : ''}
            </div>
          )}

          <div className="cam__chips">
            {SLOTS.map((slot) => {
              const state = status[slot] ?? 'empty'
              return (
                <button
                  key={slot}
                  className={[
                    'cam__chip',
                    activeSlot === slot ? 'cam__chip--on' : '',
                    shots[slot] ? 'cam__chip--filled' : '',
                    state === 'found' ? 'cam__chip--found' : '',
                  ].join(' ')}
                  onClick={() => setActiveSlot(slot)}
                >
                  {SLOT_SHORT[slot]}
                  {state === 'busy' && <span className="cam__dot cam__dot--busy" />}
                  {state === 'found' && <span className="cam__dot cam__dot--found" />}
                  {(state === 'kept' || (state === 'none' && shots[slot])) && <span className="cam__dot" />}
                </button>
              )
            })}
          </div>

          <p className="cam__hint">
            {cameraOn ? SLOT_HINT[activeSlot] : 'Tap start to use the camera.'}
          </p>

          <div className="cam__controls">

            <button
              className="cam__next"
              onClick={nextBook}
              disabled={shotCount === 0}
              title="Send these photos to the queue and start the next book"
            >
              Next book
              {shotCount > 0 && <span className="cam__count">{shotCount}/3</span>}
            </button>

            <button
              className="shutter"
              onClick={shoot}
              disabled={!cameraOn}
              aria-label={`Photograph the ${SLOT_LABEL[activeSlot]}`}
            >
              <span className="shutter__ring" />
            </button>

            <button
              className={`cam__review ${identified || draft.isbn13 ? 'cam__review--ready' : ''}`}
              onClick={() => { stopCamera(); setMode('review') }}
              disabled={busy || (!identified && shotCount === 0 && !draft.title)}
            >
              {busy ? 'Reading' : 'Review'}
              {shotCount > 0 && <span className="cam__count">{shotCount}/3</span>}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Scrolling pages
  // -----------------------------------------------------------------------

  return (
    <div className="app">
      <header className="topbar">
        <h1>Book scan</h1>
        <nav>
          <button className="tab" onClick={() => setMode('capture')}>Camera</button>
          <button
            className={mode === 'queue' ? 'tab tab--on' : 'tab'}
            onClick={() => setMode('queue')}
          >
            Queue
          </button>
          <button
            className={mode === 'library' ? 'tab tab--on' : 'tab'}
            onClick={() => setMode('library')}
          >
            Library
          </button>
        </nav>
        {counts && (
          <span className="counts">
            {counts.total} books · {counts.fiction} fiction · {counts.nonfiction} non-fiction
            {counts.unshelved > 0 ? ` · ${counts.unshelved} unshelved` : ''}
          </span>
        )}
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {mode === 'queue' && (
        <QueuePane onOpen={openCapture} onCounts={setQueueCounts} />
      )}

      {mode === 'library' && <ShelfView onOpen={openBook} />}

      {mode === 'review' && (
        <main className="main">
          <PlacementCard placement={placement} pending={placementStale} saved={false} />

          <BookDetail
            draft={draft}
            lookup={lookup}
            photos={thumbs}
            derivedFiling={derivedFiling}
            saving={saving}
            relookupBusy={relookupBusy}
            relookupError={relookupError}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onRelookup={relookup}
            onClearRelookupError={() => setRelookupError('')}
            onSave={save}
            onDiscard={reset}
            onDelete={bookId !== null ? deleteBook : undefined}
            deleting={deletingBook}
          />

          <div className="actions">
            <button className="btn" onClick={() => setMode('capture')}>
              Back to camera
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
