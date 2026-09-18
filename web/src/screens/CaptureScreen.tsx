/**
 * The cataloguing camera: three photographs of a book, handed to the queue.
 *
 * The stream, the lens, the torch and the diagnostics sheet live in
 * `app/cameraSession.tsx`; this screen only draws them and owns the shutter,
 * slot chips, and the poll that watches what the queue makes of a photograph.
 *
 * The shutter is one `onClick` straight to `shoot`, with nothing drawn in
 * front of it.
 */

import { useEffect, useState } from 'react'
import {
  cameraFactsText, currentOrigin, lensName, rememberTorch,
  SLOT_CROP, SLOT_GUIDE, SLOTS, SLOT_LABEL, SLOT_SHORT,
  thumbnail, type Slot,
} from '../lib/scanner'
import { captureSteadiest, describeBurst } from '../lib/steady'
import { rememberHand, rememberedHand } from '../lib/hand'
import { api, type LookupResponse, type QueueMatch } from '../lib/api'
import { canShelve } from '../components/QueuePane'
import { QueuedAlready } from '../components/QueuedAlready'
import { Viewfinder, type Hand } from '../design/Camera'
import { Button } from '../design/Controls'
import type { Shot } from '../design/Shots'
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
  const { setQueueCounts } = useSummary()
  const { returnToOrigin } = useLeaving()
  const { openCapture } = useOpenBook()
  const book = useBookInHand()
  const camera = useCameraSession()

  const [hand, setHand] = useState<Hand>(rememberedHand)

  const {
    draft, shots, thumbs, status, activeSlot, identified, captureId, saving,
    duplicates, duplicatesTurnedDown, catalogued,
    setShots, setThumbs, setCrops, setExamined, setStatus, setActiveSlot,
    setCaptureId, setDuplicates, setDuplicatesTurnedDown, setCatalogued,
    applyLookup, applyReading, clearBookInHand,
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
   * Take the shot and hand it straight to the queue. The queue is the only
   * thing that reads a photo; the feedback here is a view of its progress.
   *
   * The photo is kept whether or not an ISBN comes back: all three images
   * are wanted regardless.
   */
  const shoot = async () => {
    const video = videoRef.current
    if (!video) return

    const slot = activeSlot
    // A short burst, sharpest frame kept, rather than whichever frame was on
    // screen at the tap; costs about a fifth of a second. See lib/steady.ts
    // for the trade.
    const { image: full, scores, chosen, elapsedMs } = await captureSteadiest(video, {
      crop: SLOT_CROP[slot],
    })
    if (!full) {
      setError('The camera has not produced a frame yet. Give it a moment.')
      return
    }
    setBurstNote(describeBurst(scores, chosen, elapsedMs))

    setThumbs((current) => ({ ...current, [slot]: full }))
    // A fresh photo invalidates any existing crop, since a stale crop beside
    // a new photo is worse than none.
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
   */
  useEffect(() => {
    if (captureId === null) return

    let cancelled = false
    const tick = async () => {
      try {
        const {
          capture, duplicates: found, catalogued: onAShelf,
        } = await api.getCapture(captureId)
        if (cancelled) return

        // Duplicates are decided by the reading (ISBN, or failing that the
        // hash of the front) and only shown, never blocked.
        setDuplicates(found)
        // Whether it is already on a shelf is a separate question, decided
        // by the same poll, so it reaches anyone shooting book after book
        // and not just the capture's own detail screen.
        setCatalogued(onAShelf)

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
        } else if (capture.status === 'failed') {
          if (capture.note) setError(capture.note)
          /*
           * Keep what the reading did get: a barcode that decoded against a
           * catalogue with no match is `failed`, but the digits still belong
           * on the row. Nothing a person has answered is touched; see
           * `applyReading`.
           */
          applyReading(capture)
        }
      } catch {
        // A poll failing is not worth interrupting the person scanning.
      }
    }

    void tick()
    const timer = setInterval(tick, 1500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [
    captureId, identified, applyLookup, applyReading,
    setDuplicates, setCatalogued, setStatus, setError,
  ])

  /**
   * This book is already in the queue: go and finish that one instead. The
   * photographs just taken go with it, unless it turns out to be a
   * different book.
   *
   * Claimed before anything is deleted, so if somebody else is holding the
   * capture, the claim fails and nothing here is lost.
   */
  const openQueuedInstead = async (match: QueueMatch) => {
    if (!canShelve(match.capture)) {
      camera.setToast('Still reading its photographs. Give it a moment and open it from the queue.')
      return
    }

    const mine = captureId
    try {
      const { capture: claimed } = await api.claimCapture(match.capture.id, book.me)

      // Deleted only after the claim succeeds, so a failed claim does not
      // lose this capture too.
      if (mine !== null) {
        const { counts: queued } = await api.deleteCapture(mine)
        setQueueCounts(queued)
      }

      stopCamera()
      clearBookInHand()
      // The camera never saw the queue listing, so the top is the honest
      // anchor for "near where this sat", as in the scanner.
      openCapture(claimed, { id: match.capture.id, index: 0 })
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  /**
   * Turned down by id rather than by clearing the list: the list is
   * re-answered every poll, so clearing it would only bring the panel back a
   * second later.
   */
  const keepDespiteQueue = () => {
    setDuplicatesTurnedDown((seen) => [
      ...seen,
      ...duplicates.map((match) => match.capture.id).filter((id) => !seen.includes(id)),
    ])
  }

  /** Move on: the photos are already with the queue, so this only clears the camera. */
  const nextBook = () => {
    if (shotCount === 0 && !captureId) return
    returnToOrigin()
  }

  /**
   * What the queue has made of each photograph. Only the two facts the
   * photograph itself cannot show: that it is still being read, and that
   * the ISBN came off it. Whether a photograph exists is already visible in
   * the thumbnail.
   */
  const noteOn = (slot: Slot): string | undefined => {
    if (status[slot] === 'busy') return 'reading'
    if (status[slot] === 'found') return 'ISBN found'
    return undefined
  }

  // Back first, since it carries the barcode and the lookup starts on shot one.
  const slotShots: Shot[] = SLOTS.map((slot) => ({
    word: SLOT_SHORT[slot],
    sliver: slot === 'edge',
    photo: thumbs[slot],
    next: activeSlot === slot,
    note: noteOn(slot),
    onPress: () => setActiveSlot(slot),
  }))

  /*
   * The guide rectangle is `SLOT_GUIDE`, which for the spine is the same
   * rectangle `SLOT_CROP` keeps, so what somebody frames is what survives.
   *
   * `--crop` tells the stylesheet not to centre and reshape this frame the
   * way the design system's default guide is drawn, since the fractions
   * below already place it. No `--slot` either: that modifier is a shape,
   * and this element brings its own.
   */
  const frame = SLOT_GUIDE[activeSlot]
  const guide = cameraOn && (
    <div
      className="wf-view__guide wf-view__guide--crop"
      aria-hidden="true"
      style={{
        left: `${frame.x * 100}%`,
        top: `${frame.y * 100}%`,
        right: `${(1 - frame.x - frame.width) * 100}%`,
        bottom: `${(1 - frame.y - frame.height) * 100}%`,
      }}
    />
  )

  return (
    <div className="wf wf-screen wf-screen--camera">
      <Viewfinder
        shots={slotShots}
        hand={hand}
        picture={
          <video ref={videoRef} className="wf-view__video" playsInline muted autoPlay />
        }
        guide={guide}
        onLeave={() => { stopCamera(); setRoute('home') }}
        top={
          cameraOn && torchReady && activeSlot === 'edge' ? (
            <button
              type="button"
              className={torchOn ? 'wf-view__chip wf-view__chip--on' : 'wf-view__chip'}
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
          ) : undefined
        }
        far={
          /* Lens choice, diagnostics and which hand holds the phone; set
             once and not touched again. */
          <button
            type="button"
            className="wf-view__far wf-view__chip"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            Camera
          </button>
        }
        over={
          <>
            {error && (
              <div className="cam__error" onClick={() => setError('')}>{error}</div>
            )}

            {/* Positioned via `.cam__toast`, not floated, so it costs
                nothing once it has faded. */}
            {toast && <div className="cam__toast">{toast}</div>}

            {/* A finding, not a gate: the photograph is already taken and
                accepted, and whether there are two copies is not something
                a camera can decide. */}
            <QueuedAlready
              matches={queueDuplicates}
              className="queued--incam"
              note={
                'Open it to go and finish it, which drops what was just photographed. '
                + 'Carry on if this is a second copy.'
              }
              onOpen={(match) => void openQueuedInstead(match)}
              onDismiss={keepDespiteQueue}
              dismissLabel="Different book, keep what I just took"
              disabled={saving}
            />

            {/*
              A line rather than a panel, with no way past it: two copies of
              one book can genuinely happen, and the decision belongs at the
              shelving step, not here.
            */}
            {catalogued && (
              <p className="cam__catalogued" role="status">
                <strong>Already catalogued</strong>
                {` as #${catalogued.id} (${catalogued.title})`}
                {catalogued.location ? ` at ${catalogued.location}` : ''}
                . Saving it adds a second copy.
              </p>
            )}
          </>
        }
        /*
          These two must cover the controls, unlike everything in `over`
          (which stops above the bar): an ungranted camera would show "Start
          camera" with a live shutter under it otherwise, and the settings
          sheet's scrim would leave the shutter pressable outside it.
        */
        across={
          <>
            {!cameraOn && (
              <div className="wf-view__idle">
                <h2 className="wf-view__idle-head">Photograph the book</h2>
                <p className="wf-view__idle-said">
                  Back cover first, for the barcode. Then the front, then the spine.
                </p>
                <Button tone="primary" onPress={() => startCamera()}>Start camera</Button>
                {/* Camera permission and the dev certificate exception are
                    scoped to whichever origin is loaded, so a second device
                    needs to know which one it is on now. */}
                <p className="wf-view__idle-origin">On {currentOrigin()}</p>
              </div>
            )}

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

                  {/*
                    Both this and the settings screen read and write
                    `lib/hand.ts`, so choosing here moves the switch there too.
                  */}
                  <h4 className="cam__sheet-subhead">Which hand</h4>
                  <div className="cam__lenses">
                    {(['left', 'right'] as Hand[]).map((side) => (
                      <button
                        key={side}
                        className={hand === side ? 'cam__lens cam__lens--on' : 'cam__lens'}
                        aria-pressed={hand === side}
                        onClick={() => {
                          setHand(side)
                          rememberHand(side)
                        }}
                      >
                        {side === 'left' ? 'Shutter on the left' : 'Shutter on the right'}
                      </button>
                    ))}
                  </div>

                  <p className="cam__sheet-note">
                    <strong>Spine will not focus?</strong> Move the book further
                    away, not closer. You are inside the lens minimum focus
                    distance, and the crop keeps the detail.
                  </p>

                  {/* Rendered as text meant to be read aloud over a call,
                      not logged to a console, since nobody debugging this
                      owns the phone. */}
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
          </>
        }
        /*
          Handed to the bar rather than floated over the picture: this
          camera's near cluster is three controls tall, and only the bar
          component knows how tall its own controls are.
        */
        said={identified ? (
          <p className="wf-view__found">
            <strong>{draft.title}</strong>
            {draft.authors ? ` · ${draft.authors}` : ''}
          </p>
        ) : shotCount === 0 && !captureId ? (
          <p className="wf-view__found wf-view__found--empty">
            Nothing in hand. First shot starts a new book.
          </p>
        ) : undefined}
        also={{
          word: shotCount > 0 ? `Next book ${shotCount}/3` : 'Next book',
          onPress: nextBook,
          off: shotCount === 0,
        }}
        done={busy ? 'Reading the photographs' : 'Done with this book'}
        doneOff={busy || (!identified && shotCount === 0 && !draft.title)}
        onDone={() => { stopCamera(); setRoute('review') }}
        onShutter={() => void shoot()}
        shutterOff={!cameraOn}
      />
      {/* For screen readers: the shutter itself is a plain circle with no
          label for which slot it will fill. */}
      <span className="wf-sr-only" aria-live="polite">
        Next photograph: {SLOT_LABEL[activeSlot]}
      </span>
    </div>
  )
}
