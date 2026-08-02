import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, deviceName, draftFromLookup, emptyDraft,
  type Capture, type Counts, type Draft, type LookupResponse,
  type PlacementResponse, type QueueCounts,
} from './lib/api'
import {
  captureStill, describeStream, openCamera, SLOT_CROP, SLOTS, SLOT_HINT,
  SLOT_LABEL, SLOT_SHORT, stopStream, thumbnail, type Slot,
} from './lib/scanner'
import { filingName } from '../shared/shelving'
import { PlacementCard } from './components/PlacementCard'
import { ReviewPane } from './components/ReviewPane'
import { LibraryPane } from './components/LibraryPane'
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
  const [manualEntry, setManualEntry] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [captureId, setCaptureId] = useState<number | null>(null)
  const [enqueuing, setEnqueuing] = useState(false)

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
  const shoot = async () => {
    const video = videoRef.current
    if (!video) return

    const slot = activeSlot
    const full = captureStill(video, { crop: SLOT_CROP[slot] })
    if (!full) {
      setError('The camera has not produced a frame yet. Give it a moment.')
      return
    }

    setShots((current) => ({ ...current, [slot]: full }))
    setThumbs((current) => ({ ...current, [slot]: full }))
    void thumbnail(full).then((small) =>
      setThumbs((current) => ({ ...current, [slot]: small })),
    )
    setActiveSlot((current) => nextEmpty({ ...shots, [slot]: full }, current))

    // Once the book is identified the remaining photos are just record
    // keeping. Re-running barcode and OCR on them costs seconds and cannot
    // improve the answer, so keep the photo and skip the round trip.
    if (identified) {
      setStatus((current) => ({ ...current, [slot]: 'kept' }))
      return
    }

    setStatus((current) => ({ ...current, [slot]: 'busy' }))

    try {
      const response = await api.identify(full, slot, !draft.title.trim())
      const found = Boolean(response.identify.isbn13)
      setStatus((current) => ({ ...current, [slot]: found ? 'found' : 'none' }))

      setDraft((current) => ({
        ...current,
        isbnSource: response.identify.source || current.isbnSource,
        ocrText: response.identify.text || current.ocrText,
      }))

      if (response.lookup?.found && !identified) {
        applyLookup(response.lookup)
      } else if (found && !identified) {
        // The ISBN read fine but no catalogue has it. Put it in the manual
        // box so it can be corrected and retried, rather than leaving the
        // user with a message and nowhere to act on it.
        setDraft((current) => ({ ...current, isbn13: response.identify.isbn13 }))
        setManualEntry(response.identify.isbn13)
        setError(
          `Read ISBN ${response.identify.isbn13}, but no catalogue has it. ` +
            'Check the digits below and search again, or open Review to type ' +
            'the details in.',
        )
      } else if (!found && response.identify.titleGuess && !identified) {
        setDraft((current) =>
          current.title ? current : { ...current, title: response.identify.titleGuess },
        )
      }
    } catch (caught) {
      setStatus((current) => ({ ...current, [slot]: 'none' }))
      setError((caught as Error).message)
    }
  }

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
      api.previewPlacement(draft)
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
    draft.seriesIndex, draft.authorFilingOverride,
  ])

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /**
   * Manual ISBN or title entry. Takes the same path as a successful scan:
   * on a hit it fills the draft and stays on the camera, so the remaining
   * photos can still be taken. Only a miss sends the user to the form.
   */
  const lookupManual = async () => {
    const value = manualEntry.trim()
    if (!value) return

    setError('')
    setLookingUp(true)
    try {
      // Ten or thirteen digits, allowing separators and a trailing X, is an
      // ISBN. Anything else is treated as a title.
      const digits = value.replace(/[^0-9Xx]/g, '')
      const result = digits.length === 10 || digits.length === 13
        ? await api.lookupIsbn(value)
        : await api.searchTitle(value)

      if (result.found) {
        applyLookup(result)
        setManualEntry('')
      } else {
        setDraft((current) => ({
          ...current,
          ...(digits.length ? { isbn13: digits } : { title: value }),
        }))
        setError(
          `Nothing found for "${value}". Open Review to type the details in.`,
        )
      }
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLookingUp(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const result = await api.saveBook(
        draft, shots, Boolean(draft.authorFilingOverride), captureId ?? undefined,
      )
      setCounts(result.counts)
      setQueueCounts(result.queue)
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
   * Hand the photos to the queue and immediately clear for the next book.
   * Identification happens server-side afterwards, so the person holding the
   * books never waits on OCR.
   */
  const nextBook = async () => {
    if (shotCount === 0) return
    setError('')
    setEnqueuing(true)
    try {
      const result = await api.enqueue(shots)
      setQueueCounts(result.counts)
      reset()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setEnqueuing(false)
    }
  }

  /** Open a queue item in the review pane, pre-filled from its lookup. */
  const openCapture = (capture: Capture) => {
    const looked = capture.draft_json
      ? (JSON.parse(capture.draft_json) as LookupResponse)
      : null

    setCaptureId(capture.id)
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
    setMode('capture')
  }

  // -----------------------------------------------------------------------
  // Full-screen camera
  // -----------------------------------------------------------------------

  if (fullScreenCamera) {
    return (
      <div className="cam">
        <video ref={videoRef} className="cam__video" playsInline muted autoPlay />

        {cameraOn && SLOT_CROP[activeSlot] && (
          <div
            className="cam__guide"
            style={{
              left: `${SLOT_CROP[activeSlot]!.x * 100}%`,
              top: `${SLOT_CROP[activeSlot]!.y * 100}%`,
              width: `${SLOT_CROP[activeSlot]!.width * 100}%`,
              height: `${SLOT_CROP[activeSlot]!.height * 100}%`,
            }}
          >
            <span className="cam__guide-label">Fit the spine in here</span>
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
            <p>Front cover, spine, then the back cover with the barcode.</p>
            <button className="btn btn--primary btn--big" onClick={startCamera}>
              Start camera
            </button>
          </div>
        )}

        <div className="cam__bottom">
          {identified ? (
            <div className="cam__found">
              <strong>{draft.title}</strong>
              {draft.authors ? ` · ${draft.authors}` : ''}
            </div>
          ) : (
            /* Always available while the book is still unknown, and
               pre-filled with a scanned-but-unmatched ISBN so it can be
               corrected and retried in place. */
            <div className="cam__manual">
              <input
                value={manualEntry}
                onChange={(event) => setManualEntry(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void lookupManual() }}
                placeholder="Type the ISBN or a title"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                className="btn btn--primary"
                onClick={lookupManual}
                disabled={lookingUp || !manualEntry.trim()}
              >
                {lookingUp ? '...' : 'Find'}
              </button>
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
              disabled={enqueuing || shotCount === 0}
              title="Send these photos to the queue and start the next book"
            >
              {enqueuing ? '...' : 'Next book'}
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

      {mode === 'library' && <LibraryPane />}

      {mode === 'review' && (
        <main className="main">
          <PlacementCard placement={placement} pending={placementStale} saved={false} />

          {shotCount > 0 && (
            <div className="deck deck--review">
              {SLOTS.map((slot) => thumbs[slot] && (
                <figure key={slot} className="shot">
                  <img src={thumbs[slot]} alt={SLOT_LABEL[slot]} />
                  <figcaption>{SLOT_LABEL[slot]}</figcaption>
                </figure>
              ))}
            </div>
          )}

          <ReviewPane
            draft={draft}
            lookup={lookup}
            derivedFiling={derivedFiling}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onSave={save}
            onDiscard={reset}
            saving={saving}
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
