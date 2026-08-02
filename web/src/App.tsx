import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, draftFromLookup, emptyDraft,
  type Counts, type Draft, type LookupResponse, type PlacementResponse,
} from './lib/api'
import {
  captureStill, describeStream, openCamera, SLOTS, SLOT_HINT, SLOT_LABEL,
  SLOT_SHORT, stopStream, thumbnail, type Slot,
} from './lib/scanner'
import { filingName } from '../shared/shelving'
import { PlacementCard } from './components/PlacementCard'
import { ReviewPane } from './components/ReviewPane'
import { LibraryPane } from './components/LibraryPane'

type Mode = 'capture' | 'review' | 'library'
type SlotStatus = 'empty' | 'busy' | 'found' | 'none'

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
  const [activeSlot, setActiveSlot] = useState<Slot>('front')

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [lookup, setLookup] = useState<LookupResponse | null>(null)
  const [identified, setIdentified] = useState(false)
  const [placement, setPlacement] = useState<PlacementResponse | null>(null)
  const [placementStale, setPlacementStale] = useState(false)
  const [savedPlacement, setSavedPlacement] = useState<PlacementResponse | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [manualEntry, setManualEntry] = useState('')

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')
  const shotCount = SLOTS.filter((slot) => shots[slot]).length
  const busy = SLOTS.some((slot) => status[slot] === 'busy')
  const fullScreenCamera = mode === 'capture'

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

      if (response.lookup?.found && !identified) {
        applyLookup(response.lookup)
      } else if (found && !identified) {
        setDraft((current) => ({ ...current, isbn13: response.identify.isbn13 }))
        setError(
          `Found ISBN ${response.identify.isbn13} but no catalogue entry. ` +
            'Enter the details by hand.',
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
      } else {
        setDraft((current) => ({ ...current, title: value }))
        setError(`Nothing found for "${value}". Enter the details by hand.`)
      }
      setMode('review')
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
    setActiveSlot('front')
    setPlacement(null)
    setMode('capture')
  }

  // -----------------------------------------------------------------------
  // Full-screen camera
  // -----------------------------------------------------------------------

  if (fullScreenCamera) {
    return (
      <div className="cam">
        <video ref={videoRef} className="cam__video" playsInline muted autoPlay />

        <div className="cam__top">
          <button className="cam__chip-btn" onClick={() => { stopCamera(); setMode('library') }}>
            Library
          </button>
          <span className="cam__meta">
            {counts ? `${counts.total} books` : ''}
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
            <div className="manual manual--dark">
              <input
                value={manualEntry}
                onChange={(event) => setManualEntry(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void lookupManual() }}
                placeholder="Or type an ISBN or title"
              />
              <button className="btn" onClick={lookupManual}>Look up</button>
            </div>
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
                  {state === 'none' && shots[slot] && <span className="cam__dot" />}
                </button>
              )
            })}
          </div>

          <p className="cam__hint">
            {cameraOn ? SLOT_HINT[activeSlot] : 'Tap start to use the camera.'}
          </p>

          <div className="cam__controls">
            <div className="cam__thumbs">
              {SLOTS.map((slot) => (
                <span key={slot} className="cam__thumb" aria-hidden>
                  {thumbs[slot] && <img src={thumbs[slot]} alt="" />}
                </span>
              ))}
            </div>

            <button
              className="shutter"
              onClick={shoot}
              disabled={!cameraOn}
              aria-label={`Photograph the ${SLOT_LABEL[activeSlot]}`}
            >
              <span className="shutter__ring" />
            </button>

            <button
              className="cam__review"
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
