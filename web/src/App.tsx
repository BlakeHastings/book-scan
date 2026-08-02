import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, deviceName, draftFromBook, draftFromLookup, emptyDraft,
  type Capture, type Counts, type Draft, type LookupResponse,
  type PlacementResponse, type QueueCounts,
} from './lib/api'
import {
  applyFocusHints, captureStill, describeStream, listLenses, openCamera,
  lensName, preferredLens, rememberedLens, rememberLens, SLOT_CROP, SLOT_GUIDE,
  SLOT_GUIDE_LABEL, SLOTS, SLOT_HINT, SLOT_LABEL, SLOT_SHORT, stopStream,
  thumbnail, type Lens, type Slot,
} from './lib/scanner'
import { filingName } from '../shared/shelving'
import { BookDetail } from './components/BookDetail'
import { PlacementView } from './components/ShelfStrip'
import { ShelfView } from './components/ShelfView'
import { ShelveView } from './components/ShelveView'
import { QueuePane } from './components/QueuePane'

type Mode = 'capture' | 'review' | 'shelve' | 'library' | 'queue'
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
  const [lenses, setLenses] = useState<Lens[]>([])
  const [lensId, setLensId] = useState(rememberedLens())
  const [focusNote, setFocusNote] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
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
  const [counts, setCounts] = useState<Counts | null>(null)
  const [relookupBusy, setRelookupBusy] = useState(false)
  const [relookupError, setRelookupError] = useState('')
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [captureId, setCaptureId] = useState<number | null>(null)
  const [bookId, setBookId] = useState<number | null>(null)
  const [deletingBook, setDeletingBook] = useState(false)
  const [checkedOutAt, setCheckedOutAt] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)

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
  const startCamera = async (preferred = lensId) => {
    setError('')
    try {
      const stream = await openCamera(preferred)
      streamRef.current = stream
      setCameraOn(true)
      setResolution(describeStream(stream))

      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        // Deliberately not awaited: a stream that never delivers a frame
        // leaves this pending forever, and the lens work below must not be
        // held up by it.
        void video.play().catch(() => {})
      }

      // Lens labels stay blank until permission is granted, so the list can
      // only be read once a stream is actually open.
      const found = await listLenses()
      setLenses(found)
      if (!preferred && found.length > 1) {
        const pick = preferredLens(found)
        // Reopen pinned to one physical lens, so the phone stops swapping
        // between wide and ultra-wide while a book is being lined up.
        if (pick) {
          stopStream(stream)
          setLensId(pick)
          rememberLens(pick)
          void startCamera(pick)
          return
        }
      }

      setFocusNote((await applyFocusHints(stream, activeSlot === 'edge')).join(', '))
    } catch (caught) {
      setError((caught as Error).message)
      stopCamera()
    }
  }

  const switchLens = async (deviceId: string) => {
    setLensId(deviceId)
    rememberLens(deviceId)
    stopCamera()
    await startCamera(deviceId)
  }

  // The spine is shot closest, so re-apply the hints when that slot is picked.
  useEffect(() => {
    if (!cameraOn) return
    void applyFocusHints(streamRef.current, activeSlot === 'edge')
      .then((applied) => setFocusNote(applied.join(', ')))
  }, [activeSlot, cameraOn])

  // Say what this slot wants, then get out of the way. A hint that lives on
  // screen permanently stops being read and only costs you viewfinder.
  useEffect(() => {
    if (!cameraOn) {
      setToast('')
      return
    }
    setToast(SLOT_HINT[activeSlot])
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [activeSlot, cameraOn])

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

  const loadPlacement = useCallback(() => {
    return api.previewPlacement(draft, bookId ?? undefined)
      .then((result) => {
        setPlacement(result)
        setPlacementStale(false)
      })
      .catch((caught) => setError((caught as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same fields
    // the debounced effect below watches; draft as a whole changes on keystroke.
  }, [
    draft.title, draft.authors, draft.isFiction, draft.seriesName,
    draft.seriesIndex, draft.authorFilingOverride, bookId,
  ])

  /** After books have physically moved, so the drawn shelf matches the shelf. */
  const refreshPlacement = useCallback(() => {
    setPlacementStale(true)
    return loadPlacement()
  }, [loadPlacement])

  useEffect(() => {
    if ((mode !== 'review' && mode !== 'shelve') || !draft.title.trim()) {
      setPlacement(null)
      return
    }
    setPlacementStale(true)
    const timer = setTimeout(loadPlacement, 250)
    return () => clearTimeout(timer)
  }, [mode, draft.title, loadPlacement])

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

  /**
   * Write the book. `stay` is the difference between finishing a new book,
   * which hands the screen back to the camera for the next one, and editing a
   * catalogued book, where throwing you out to the camera would be absurd.
   */
  const persist = async (stay: boolean): Promise<boolean> => {
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
      // result.placement is deliberately dropped. The server still recomputes
      // it at save time, but you have just come through the shelving step
      // with the book in your hand, so repeating the instruction over the
      // next book's viewfinder tells you nothing you did not act on.
      // Coming out of the shelving step with a book that was off the shelf
      // means it is back on one. Done here rather than in the view, so it
      // cannot be missed by a route that skips the shelving step.
      if (bookId !== null && checkedOutAt) {
        await api.setCheckedOut(bookId, false).catch(() => {})
      }
      if (stay) await refreshPlacement()
      else reset()
      return true
    } catch (caught) {
      setError((caught as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const checkOut = async (out: boolean) => {
    if (bookId === null) return
    setCheckingOut(true)
    setError('')
    try {
      const result = await api.setCheckedOut(bookId, out)
      setCheckedOutAt(result.book.checked_out_at)
      setCounts(result.counts)
      // The shelf has closed up behind it, so the drawing is stale.
      await refreshPlacement()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setCheckingOut(false)
    }
  }

  // Named wrappers rather than passing persist straight to a handler: onClick
  // hands its callback a MouseEvent, which would arrive as a truthy `stay`.
  /** Finish a new book and hand the screen back to the camera. */
  const save = () => persist(false)

  /** Write edits to a catalogued book without leaving it. */
  const saveEdits = () => persist(true)

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
      setCheckedOutAt(book.checked_out_at)
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

  /** Leave a catalogued book the way you came in. */
  const backToLibrary = () => {
    setBookId(null)
    setCheckedOutAt(null)
    setDraft(emptyDraft)
    setPlacement(null)
    setMode('library')
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
    setCheckedOutAt(null)
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
          <span className="cam__meta">{counts ? `${counts.total} shelved` : ''}</span>
          {(shotCount > 0 || identified) && (
            <button className="cam__chip-btn" onClick={reset}>Start over</button>
          )}
          {/* Lens choice and diagnostics live behind this. They are set once
              and then never touched, so they do not earn permanent space. */}
          <button
            className="cam__chip-btn cam__chip-btn--icon"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Camera settings"
          >
            ⚙
          </button>
        </div>

        {settingsOpen && (
          <div className="cam__sheet" onClick={() => setSettingsOpen(false)}>
            <div className="cam__sheet-body" onClick={(e) => e.stopPropagation()}>
              <h3>Camera</h3>

              {lenses.length > 1 ? (
                <>
                  <p className="cam__sheet-note">
                    Pinned to one lens so the phone stops swapping mid-shot.
                  </p>
                  <div className="cam__lenses">
                    {lenses.map((lens) => (
                      <button
                        key={lens.deviceId}
                        className={lens.deviceId === lensId ? 'cam__lens cam__lens--on' : 'cam__lens'}
                        onClick={() => { void switchLens(lens.deviceId); setSettingsOpen(false) }}
                      >
                        {lensName(lens.label)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="cam__sheet-note">This device reports one rear lens.</p>
              )}

              <p className="cam__sheet-note">
                <strong>Spine will not focus?</strong> Move the book further
                away, not closer. You are inside the lens minimum focus
                distance, and the crop keeps the detail.
              </p>

              <p className="cam__sheet-meta">
                {resolution || 'no stream'}
                {focusNote ? ` · ${focusNote}` : ''}
              </p>

              <button className="btn" onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
          </div>
        )}

        {error && <div className="cam__error" onClick={() => setError('')}>{error}</div>}

        {!cameraOn && (
          <div className="cam__idle">
            <h2>Photograph the book</h2>
            <p>Back cover first, for the barcode. Then the front, then the spine.</p>
            <button className="btn btn--primary btn--big" onClick={() => startCamera()}>
              Start camera
            </button>
          </div>
        )}

        {/* Transient, and above the bottom band rather than inside it, so it
            costs nothing once it has faded. */}
        {toast && <div className="cam__toast">{toast}</div>}

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
          </span>
        )}
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {mode === 'shelve' && (
        <ShelveView
          placement={placement}
          range={draft.isFiction ? 'fiction' : 'nonfiction'}
          title={draft.title || 'this book'}
          saving={saving}
          onShelved={() => save()}
          onBack={() => setMode('review')}
          onRefresh={refreshPlacement}
        />
      )}

      {mode === 'queue' && (
        <QueuePane onOpen={openCapture} onCounts={setQueueCounts} />
      )}

      {mode === 'library' && <ShelfView onOpen={openBook} />}

      {mode === 'review' && (
        <main className="main">
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
            saved={bookId !== null}
            /*
             * Only for a book that is actually on a shelf, where the drawing
             * says where it is. For one still being scanned it would be
             * answering a question nobody has asked yet, on a page already
             * asking them to check a dozen fields. The shelving step puts it
             * back when they say they are ready to place it.
             */
            placement={bookId !== null ? (
              <PlacementView
                placement={placement}
                pending={placementStale}
                instruction={false}
              />
            ) : undefined}
            doneLabel={bookId !== null ? 'Back to library' : 'Done'}
            onShelve={() => setMode('shelve')}
            onSaveEdits={saveEdits}
            onDiscard={bookId !== null ? backToLibrary : reset}
            shelfLabel={placement?.derivedLocation ?? ''}
            onDelete={bookId !== null ? deleteBook : undefined}
            deleting={deletingBook}
            checkedOutAt={checkedOutAt}
            onCheckOut={bookId !== null ? checkOut : undefined}
            checkingOut={checkingOut}
          />

          {/* Only for a book still being scanned. A catalogued book came
              from the library and goes back there. */}
          {bookId === null && (
            <div className="actions">
              <button className="btn" onClick={() => setMode('capture')}>
                Back to camera
              </button>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
