import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, draftFromLookup, emptyDraft,
  type Counts, type Draft, type LookupResponse, type PlacementResponse,
} from './lib/api'
import type { ScannerControls } from './lib/scanner'
import { filingName } from '../shared/shelving'

/**
 * ZXing is the bulk of the bundle and is useless until the camera starts, so
 * it loads on the first tap of "Start camera" rather than on page load. That
 * keeps the first paint quick over phone wifi.
 */
type ScannerModule = typeof import('./lib/scanner')
let scannerPromise: Promise<ScannerModule> | null = null
const loadScanner = () => (scannerPromise ??= import('./lib/scanner'))
import { PlacementCard } from './components/PlacementCard'
import { ReviewPane } from './components/ReviewPane'
import { LibraryPane } from './components/LibraryPane'

type Mode = 'scan' | 'review' | 'library'

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<ScannerControls | null>(null)

  const [mode, setMode] = useState<Mode>('scan')
  const [cameraOn, setCameraOn] = useState(false)
  const [resolution, setResolution] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [lookup, setLookup] = useState<LookupResponse | null>(null)
  const [cover, setCover] = useState('')
  const [placement, setPlacement] = useState<PlacementResponse | null>(null)
  const [placementStale, setPlacementStale] = useState(false)
  const [savedPlacement, setSavedPlacement] = useState<PlacementResponse | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [manualIsbn, setManualIsbn] = useState('')

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')

  useEffect(() => {
    api.health().then((h) => setCounts(h.counts)).catch(() => {})
  }, [])

  // -----------------------------------------------------------------------
  // Camera
  // -----------------------------------------------------------------------

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    // Stopping tracks inline rather than through the lazy module, so teardown
    // works even if the module never finished loading.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
    setResolution('')
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  const handleIsbn = useCallback(async (isbn: string) => {
    // Freeze the frame we decoded from before any await, so the cover matches
    // the book that was actually in shot. The module is guaranteed loaded
    // here: this only runs from the decode callback.
    const scanner = await loadScanner()
    if (videoRef.current) setCover(scanner.captureStill(videoRef.current))

    setBusy(true)
    setError('')
    try {
      const result = await api.lookupIsbn(isbn)
      setLookup(result)
      if (result.found) {
        setDraft(draftFromLookup(result))
      } else {
        setDraft({ ...emptyDraft, isbn13: isbn })
        setError(`ISBN ${isbn} was not found. Enter the details by hand.`)
      }
      setMode('review')
      stopCamera()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }, [stopCamera])

  // getUserMedia needs a user gesture on iOS, so this is only ever called
  // from a button press.
  const startCamera = async () => {
    setError('')
    try {
      const scanner = await loadScanner()
      const stream = await scanner.openCamera()
      streamRef.current = stream
      setCameraOn(true)
      setResolution(scanner.describeStream(stream))

      const video = videoRef.current
      if (!video) return
      controlsRef.current = await scanner.startDecoding(stream, video, (isbn) => {
        void handleIsbn(isbn)
      })
    } catch (caught) {
      setError((caught as Error).message)
      stopCamera()
    }
  }

  // -----------------------------------------------------------------------
  // Live placement preview
  // -----------------------------------------------------------------------

  // Recomputed as the user edits, debounced so typing an author does not fire
  // a request per keystroke. This is the "live" part of the brief: the
  // instruction updates the moment the fiction toggle or author changes.
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
          // Only auto-fill the location while the user has not touched it.
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
    const value = manualIsbn.trim()
    if (!value) return
    if (/^\d[\dXx-]{8,}$/.test(value)) {
      await handleIsbn(value)
    } else {
      setBusy(true)
      try {
        const result = await api.searchTitle(value)
        setLookup(result)
        setDraft(result.found ? draftFromLookup(result) : { ...emptyDraft, title: value })
        setMode('review')
        stopCamera()
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setBusy(false)
      }
    }
    setManualIsbn('')
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const result = await api.saveBook(draft, cover, Boolean(draft.authorFilingOverride))
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
    setCover('')
    setPlacement(null)
    setMode('scan')
  }

  // -----------------------------------------------------------------------

  return (
    <div className="app">
      <header className="topbar">
        <h1>Book scan</h1>
        <nav>
          <button className={mode !== 'library' ? 'tab tab--on' : 'tab'} onClick={() => setMode(mode === 'library' ? 'scan' : mode)}>
            Scan
          </button>
          <button className={mode === 'library' ? 'tab tab--on' : 'tab'} onClick={() => setMode('library')}>
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
          {/* The instruction from the last saved book stays visible while the
              user walks to the shelf and comes back for the next scan. */}
          {mode === 'scan' && savedPlacement && (
            <PlacementCard placement={savedPlacement} pending={false} saved />
          )}

          {mode === 'review' && (
            <PlacementCard placement={placement} pending={placementStale} saved={false} />
          )}

          <section className={mode === 'review' ? 'camera camera--hidden' : 'camera'}>
            <video
              ref={videoRef}
              className="camera__video"
              playsInline
              muted
              autoPlay
            />
            {!cameraOn && (
              <div className="camera__idle">
                <p>Point the back camera at the barcode on the back cover.</p>
                <button className="btn btn--primary btn--big" onClick={startCamera}>
                  Start camera
                </button>
              </div>
            )}
            {cameraOn && (
              <div className="camera__hud">
                <span>{busy ? 'Looking up...' : 'Scanning for ISBN'}</span>
                {resolution && <span className="camera__res">{resolution}</span>}
                <button className="btn btn--ghost" onClick={stopCamera}>Stop</button>
              </div>
            )}
          </section>

          {mode === 'scan' && (
            <div className="manual">
              <input
                value={manualIsbn}
                onChange={(event) => setManualIsbn(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void lookupManual() }}
                placeholder="Or type an ISBN or a title"
              />
              <button className="btn" onClick={lookupManual} disabled={busy}>
                Look up
              </button>
            </div>
          )}

          {mode === 'review' && (
            <>
              {cover && <img className="cover" src={cover} alt="Captured cover" />}
              <ReviewPane
                draft={draft}
                lookup={lookup}
                derivedFiling={derivedFiling}
                onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                onSave={save}
                onDiscard={reset}
                saving={saving}
              />
            </>
          )}
        </main>
      )}
    </div>
  )
}
