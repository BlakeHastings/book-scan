/**
 * The cataloguing camera: three photographs of a book, handed to the queue.
 *
 * The stream, the lens, the torch and the diagnostics sheet are not in this
 * file. They live in `app/cameraSession.tsx`, which keeps the lifetime they
 * have always had, and this screen draws them. What is here is what belongs
 * to the screen: the shutter, the slot chips, the poll that watches what the
 * queue makes of a photograph, and the answer to "this book is already in the
 * queue".
 */

import { useEffect } from 'react'
import {
  cameraFactsText, currentOrigin, lensName, rememberTorch,
  SLOT_CROP, SLOT_GUIDE, SLOT_GUIDE_LABEL, SLOTS, SLOT_LABEL, SLOT_SHORT,
  thumbnail, type Slot,
} from '../lib/scanner'
import { captureSteadiest, describeBurst } from '../lib/steady'
import { api, type LookupResponse, type QueueMatch } from '../lib/api'
import { canShelve } from '../components/QueuePane'
import { QueuedAlready } from '../components/QueuedAlready'
import { useBookInHand } from '../app/bookInHand'
import { useCameraSession } from '../app/cameraSession'
import { useSummary } from '../app/summary'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

/** Next slot with no photo in it, so the shutter advances by itself. */
function nextEmpty(shots: Partial<Record<Slot, string>>, from: Slot): Slot {
  const order = [...SLOTS.slice(SLOTS.indexOf(from) + 1), ...SLOTS]
  return order.find((slot) => !shots[slot]) ?? from
}

export function CaptureScreen() {
  const { setRoute } = useNavigation()
  const { error, setError } = useErrorBanner()
  const { counts, queueCounts, setQueueCounts } = useSummary()
  const { returnToOrigin } = useLeaving()
  const { openCapture } = useOpenBook()
  const book = useBookInHand()
  const camera = useCameraSession()

  const {
    draft, shots, status, activeSlot, identified, captureId, saving,
    duplicates, duplicatesTurnedDown,
    setShots, setThumbs, setCrops, setExamined, setStatus, setActiveSlot,
    setCaptureId, setDuplicates, setDuplicatesTurnedDown,
    applyLookup, clearBookInHand,
  } = book

  const {
    videoRef, cameraOn, resolution, lenses, lensId, focusNote, settingsOpen,
    setSettingsOpen, torchReady, torchOn, setTorchOn, burstNote, setBurstNote,
    facts, factsCopied, setFactsCopied, toast,
    startCamera, stopCamera, switchLens,
  } = camera

  /** What is still worth saying: found, and not already turned down. */
  const queueDuplicates = duplicates.filter(
    (match) => !duplicatesTurnedDown.includes(match.capture.id),
  )
  const shotCount = SLOTS.filter((slot) => shots[slot]).length
  const busy = SLOTS.some((slot) => status[slot] === 'busy')

  // The camera view is a fixed overlay, so the document behind it must not
  // scroll or iOS will rubber-band the whole page under the controls.
  useEffect(() => {
    document.body.classList.add('body--locked')
    return () => document.body.classList.remove('body--locked')
  }, [])

  /**
   * Take the shot and hand it straight to the queue.
   *
   * Nothing is identified inline any more. The camera used to call a
   * synchronous identify endpoint for feedback and the queue then read the
   * very same image again, so every book paid for the expensive pass twice.
   * Now the queue is the only thing that reads a photo, and the feedback here
   * is a view of its progress.
   *
   * The photo is kept whether or not an ISBN comes back: all three images are
   * wanted regardless, and a failed read is no reason to throw a photo away.
   */
  const shoot = async () => {
    const video = videoRef.current
    if (!video) return

    const slot = activeSlot
    // A short burst, sharpest frame kept, rather than whichever frame happened
    // to be on screen at the tap. Costs about a fifth of a second and no extra
    // tap; see web/src/lib/steady.ts for why that is the trade.
    const { image: full, scores, chosen, elapsedMs } = await captureSteadiest(video, {
      crop: SLOT_CROP[slot],
    })
    if (!full) {
      setError('The camera has not produced a frame yet. Give it a moment.')
      return
    }
    setBurstNote(describeBurst(scores, chosen, elapsedMs))

    setThumbs((current) => ({ ...current, [slot]: full }))
    // A fresh photo makes any crop of the one it replaced meaningless, and a
    // stale crop shown beside a new photo is worse than no crop.
    setCrops((current) => ({ ...current, [slot]: undefined }))
    setExamined((current) => current.filter((seen) => seen !== slot))
    void thumbnail(full).then((small) =>
      setThumbs((current) => ({ ...current, [slot]: small })),
    )
    setStatus((current) => ({ ...current, [slot]: 'busy' }))
    setShots((current) => ({ ...current, [slot]: full }))
    setActiveSlot((current) => nextEmpty({ ...shots, [slot]: full }, current))

    try {
      const { capture, counts: queued } = await api.addPhoto(full, slot, captureId)
      setCaptureId(capture.id)
      setQueueCounts(queued)
    } catch (caught) {
      setStatus((current) => ({ ...current, [slot]: 'none' }))
      setError((caught as Error).message)
    }
  }

  /**
   * Watch the capture the camera is filling, so the chips and the banner
   * reflect what the queue has actually read. Stops once it settles.
   *
   * Mounted with this screen, which is what the `mode !== 'capture'` guard on
   * it used to say.
   */
  useEffect(() => {
    if (captureId === null) return

    let cancelled = false
    const tick = async () => {
      try {
        const { capture, duplicates: found } = await api.getCapture(captureId)
        if (cancelled) return

        // Whether this book is already in the queue arrives with the reading,
        // because it is decided from what the reading produced: the ISBN off
        // the barcode, and failing that the hash of the front. Nothing is
        // blocked or undone by it; it is drawn over the viewfinder and waits.
        setDuplicates(found)

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
          if (looked.found && !identified) applyLookup(looked, capture.isbn_source)
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
  }, [captureId, identified, applyLookup, setDuplicates, setStatus, setError])

  /**
   * The same answer, given at the cataloguing camera instead of the scanner
   * (#146): this book is already in the queue, go and finish that one.
   *
   * The difference is that here the second capture already exists. It was
   * created by the shutter, before anything had read the photograph, which is
   * the only moment at which nothing can be known about the book. So the
   * choice offered is a real one and it is offered after the fact: go to the
   * capture somebody already made, and the photographs just taken go with it,
   * or say this is a different book and keep them.
   *
   * Claimed before anything is deleted. If somebody else is holding the
   * capture, the claim fails, and the person keeps what they photographed and
   * decides again rather than losing it to a trip that went nowhere.
   */
  const openQueuedInstead = async (match: QueueMatch) => {
    if (!canShelve(match.capture)) {
      camera.setToast('Still reading its photographs. Give it a moment and open it from the queue.')
      return
    }

    const mine = captureId
    try {
      const { capture: claimed } = await api.claimCapture(match.capture.id, book.me)

      // Only now. These photographs are of a book that is already in the
      // queue, and the person has just said so, so the row they would leave
      // behind is the duplicate this whole answer exists to prevent.
      if (mine !== null) {
        const { counts: queued } = await api.deleteCapture(mine)
        setQueueCounts(queued)
      }

      stopCamera()
      clearBookInHand()
      // The scanner's reasoning for the anchor holds here too: the camera never
      // saw the queue listing, so the top of it is the honest answer to "near
      // where this sat".
      openCapture(claimed, { id: match.capture.id, index: 0 })
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  /**
   * "It is a different book." Two copies of one title genuinely turn up, and
   * the cover comparison, tight as its bar is, is still a comparison.
   *
   * Turned down by id rather than by clearing the list, because the list is
   * re-answered every poll: clearing it would put the panel back a second and
   * a half later, which is an answer with no way past it.
   */
  const keepDespiteQueue = () => {
    setDuplicatesTurnedDown((seen) => [
      ...seen,
      ...duplicates.map((match) => match.capture.id).filter((id) => !seen.includes(id)),
    ])
  }

  /**
   * Move on. The photos are already with the queue, so this only clears the
   * camera; whatever the queue makes of them shows up in the Queue tab.
   */
  const nextBook = () => {
    if (shotCount === 0 && !captureId) return
    returnToOrigin()
  }

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
        <button className="cam__chip-btn" onClick={() => { stopCamera(); setRoute('home') }}>
          Home
        </button>
        <button className="cam__chip-btn" onClick={() => { stopCamera(); setRoute('library') }}>
          Library
        </button>
        <button className="cam__chip-btn" onClick={() => { stopCamera(); setRoute('queue') }}>
          Queue
          {queueCounts && queueCounts.pending + queueCounts.ready + queueCounts.failed > 0 && (
            <span className="cam__badge">
              {queueCounts.pending + queueCounts.ready + queueCounts.failed}
            </span>
          )}
        </button>
        {/* Only where there is a torch to offer, and only on the shot that
            wants it, so it is never a control somebody has to think past. */}
        {cameraOn && torchReady && activeSlot === 'edge' && (
          <button
            className={torchOn ? 'cam__chip-btn cam__chip-btn--on' : 'cam__chip-btn'}
            onClick={() => {
              const next = !torchOn
              setTorchOn(next)
              rememberTorch(next)
            }}
            aria-pressed={torchOn}
            title="More light means a shorter exposure, which means less blur"
          >
            {torchOn ? 'Light on' : 'Light'}
          </button>
        )}
        <span className="cam__meta">{counts ? `${counts.total} shelved` : ''}</span>
        {(shotCount > 0 || identified) && (
          <button className="cam__chip-btn" onClick={returnToOrigin}>Start over</button>
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

            {/* Written to be read out loud. Which lens, what it granted, and
                how many pixels a spine actually arrives with cannot be
                settled from here: nobody working on this owns the phone
                (#92). So the phone answers, in words rather than in a
                console. */}
            <h4 className="cam__sheet-subhead">What this camera reports</h4>
            <dl className="cam__facts">
              {facts.map((fact) => (
                <div className="cam__fact" key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>

            {burstNote && <p className="cam__sheet-meta">{burstNote}</p>}

            <button
              className="btn btn--ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(cameraFactsText(facts))
                  .then(() => setFactsCopied(true))
                  .catch(() => setFactsCopied(false))
              }}
            >
              {factsCopied ? 'Copied' : 'Copy these'}
            </button>

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
          {/* Vite prints eight addresses at startup and only some reach a
              phone; the camera permission and the dev certificate exception
              are both scoped to whichever one is actually loaded, so a
              second device that once loaded a different address needs to
              know which one it is on now (#60). */}
          <p className="cam__idle-origin">On {currentOrigin()}</p>
        </div>
      )}

      {/* Transient, and above the bottom band rather than inside it, so it
          costs nothing once it has faded. */}
      {toast && <div className="cam__toast">{toast}</div>}

      {/* The book in your hands is already in the queue (#146). Drawn over
          the viewfinder and nowhere near the shutter, because it is a
          finding and not a gate: the photograph has already been taken and
          accepted, and whether there are two copies of this book is not
          something a camera can know. */}
      <QueuedAlready
        matches={queueDuplicates}
        className="isbncam__choices--incam"
        note={
          'Open it to go and finish it, which drops what was just photographed. '
          + 'Carry on if this is a second copy.'
        }
        onOpen={(match) => void openQueuedInstead(match)}
        onDismiss={keepDespiteQueue}
        dismissLabel="Different book, keep what I just took"
        disabled={saving}
      />

      <div className="cam__bottom">
        {identified && (
          <div className="cam__found">
            <strong>{draft.title}</strong>
            {draft.authors ? ` · ${draft.authors}` : ''}
          </div>
        )}
        {/* The other half of fixing #62: whoever is holding the phone can
            always read whether a book is in hand, not just infer it from
            nothing being shown. This only shows for a genuinely empty
            session; once a shot lands or the queue's read comes back, the
            banner above takes over. */}
        {!identified && shotCount === 0 && !captureId && (
          <div className="cam__found cam__found--empty">
            Nothing in hand. First shot starts a new book.
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
            onClick={() => { stopCamera(); setRoute('review') }}
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
