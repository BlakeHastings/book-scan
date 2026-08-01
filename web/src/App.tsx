import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, draftFromLookup, emptyDraft,
  type Counts, type Draft, type LookupResponse, type PlacementResponse,
} from './lib/api'
import {
  captureStill, describeStream, openCamera, SLOTS, SLOT_HINT, SLOT_LABEL,
  stopStream, thumbnail, type Slot,
} from './lib/scanner'
import { filingName } from '../shared/shelving'
import { CaptureDeck, type SlotStatus } from './components/CaptureDeck'
import { PlacementCard } from './components/PlacementCard'
import { ReviewPane } from './components/ReviewPane'
import { LibraryPane } from './components/LibraryPane'

type Mode = 'capture' | 'review' | 'library'

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

  // Full-resolution captures go to the server; thumbs are what we render.
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

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')

  useEffect(() => {
    api.health().then((h) => setCounts(h.counts)).catch(() => {})
  }, [])

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
      // Keep anything the user already typed by hand.
      location: current.location,
      notes: current.notes,
    }))
  }

  /**
   * Take the shot, then send it for identification. The photo is kept
   * regardless of whether an ISBN comes back: the user asked for all three
   * images stored, and a failed read is not a reason to throw a photo away.
   */
  const shoot = async () => {
    const video = videoRef.current
    if (!video) return

    const slot = activeSlot
    const full = captureStill(video)
    if (!full) {
      setError('The camera has not produced a frame yet. Give it a moment.')
      return
    }

    setShots((current) => ({ ...current, [slot]: full }))
    setThumbs((current) => ({ ...current, [slot]: full }))
    void thumbnail(full).then((small) =>
      setThumbs((current) => ({ ...current, [slot]: small })),
    )
    setStatus((current) => ({ ...current, [slot]: 'busy' }))
    setActiveSlot((current) => nextEmpty({ ...shots, [slot]: full }, current))

    try {
      const response = await api.identify(full, slot)
      const found = Boolean(response.identify.isbn13)
      setStatus((current) => ({ ...current, [slot]: found ? 'found' : 'none' }))

      setDraft((current) => ({
        ...current,
        isbnSource: response.identify.source || current.isbnSource,
        ocrText: response.identify.text || current.ocrText,
      }))

      // Do not overwrite a book we already identified from another photo.
      if (response.lookup?.found && !identified) {
        applyLookup(response.lookup)
      } else if (found && !identified) {
        setDraft((current) => ({ ...current, isbn13: response.identify.isbn13 }))
        setError(
          `Found ISBN ${response.identify.isbn13} but no catalogue entry. ` +
            'Enter the details by hand.',
        )
      } else if (!found && response.identify.titleGuess && !identified) {
        // No ISBN anywhere, but the cover gave us a title to search on.
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

  const lookupManual = async () => {
    const value = manualEntry.trim()
    if (!value) return
    setError('')
    try {
      const result = /^[\d\s-]{9,}[\dXx]?$/.test(value)
        ? await api.lookupIsbn(value)
        : await api.searchTitle(value)
      if (result.found) {
        applyLookup(result)
        setMode('review')
      } else {
        setDraft((current) => ({ ...current, title: value }))
        setError(`Nothing found for "${value}". Enter the details by hand.`)
        setMode('review')
      }
    } catch (caught) {
      setError((caught as Error).message)
    }
    setManualEntry('')
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const result = await api.saveBook(draft, shots, Boolean(draft.authorFilingOverride))
      setCounts(result.counts)
      setSavedPlacement(placement)
      reset()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setDraft(emptyDraft)
    setLookup(null)
    setIdentified(false)
    setShots({})
    setThumbs({})
    setStatus({})
    setActiveSlot('back')
    setPlacement(null)
    setMode('capture')
  }

  const shotCount = SLOTS.filter((slot) => shots[slot]).length
  const busy = SLOTS.some((slot) => status[slot] === 'busy')

  // -----------------------------------------------------------------------

  return (
    <div className="app">
      <header className="topbar">
        <h1>Book scan</h1>
        <nav>
          <button
            className={mode !== 'library' ? 'tab tab--on' : 'tab'}
            onClick={() => setMode(mode === 'library' ? 'capture' : mode)}
          >
            Scan
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

      {mode === 'library' && <LibraryPane />}

      {mode !== 'library' && (
        <main className="main">
          {mode === 'capture' && savedPlacement && (
            <PlacementCard placement={savedPlacement} pending={false} saved />
          )}
          {mode === 'review' && (
            <PlacementCard placement={placement} pending={placementStale} saved={false} />
          )}

          {mode === 'capture' && (
            <>
              <section className="camera">
                <video ref={videoRef} className="camera__video" playsInline muted autoPlay />
                {!cameraOn && (
                  <div className="camera__idle">
                    <p>Take three photos of the book: cover, back, spine.</p>
                    <button className="btn btn--primary btn--big" onClick={startCamera}>
                      Start camera
                    </button>
                  </div>
                )}
                {cameraOn && (
                  <div className="camera__hud">
                    <span>Next: <strong>{SLOT_LABEL[activeSlot]}</strong></span>
                    {resolution && <span className="camera__res">{resolution}</span>}
                  </div>
                )}
              </section>

              {cameraOn && <p className="hint hint--center">{SLOT_HINT[activeSlot]}</p>}

              <CaptureDeck
                thumbs={thumbs}
                status={status}
                active={activeSlot}
                onSelect={setActiveSlot}
              />

              {cameraOn && (
                <div className="shutter-row">
                  <button className="shutter" onClick={shoot} aria-label="Take photo">
                    <span className="shutter__ring" />
                  </button>
                </div>
              )}

              {identified && (
                <div className="found">
                  Identified: <strong>{draft.title}</strong>
                  {draft.authors ? ` by ${draft.authors}` : ''}
                  {draft.isbnSource ? ` (${draft.isbnSource})` : ''}
                </div>
              )}

              <div className="actions">
                <button
                  className="btn btn--primary"
                  onClick={() => setMode('review')}
                  disabled={busy || (!identified && shotCount === 0 && !draft.title)}
                >
                  {busy ? 'Reading...' : `Review${shotCount ? ` (${shotCount}/3 photos)` : ''}`}
                </button>
                {(shotCount > 0 || identified) && (
                  <button className="btn" onClick={reset}>Start over</button>
                )}
              </div>

              <div className="manual">
                <input
                  value={manualEntry}
                  onChange={(event) => setManualEntry(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void lookupManual() }}
                  placeholder="Or type an ISBN or a title"
                />
                <button className="btn" onClick={lookupManual}>Look up</button>
              </div>
            </>
          )}

          {mode === 'review' && (
            <>
              <div className="deck deck--review">
                {SLOTS.map((slot) => thumbs[slot] && (
                  <figure key={slot} className="shot">
                    <img src={thumbs[slot]} alt={SLOT_LABEL[slot]} />
                    <figcaption>{SLOT_LABEL[slot]}</figcaption>
                  </figure>
                ))}
              </div>

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
            </>
          )}
        </main>
      )}
    </div>
  )
}
