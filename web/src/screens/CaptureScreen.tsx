/**
 * The cataloguing camera: three photographs of a book, handed to the queue.
 *
 * The stream, the lens, the torch and the diagnostics sheet are not in this
 * file. They live in `app/cameraSession.tsx`, which keeps the lifetime they
 * have always had, and this screen draws them. What is here is what belongs
 * to the screen: the shutter, the slot chips, the poll that watches what the
 * queue makes of a photograph, and the answer to "this book is already in the
 * queue".
 *
 * ## What #316 changed here, and what it did not
 *
 * The chrome, and only the chrome. This screen is drawn by `Viewfinder` now,
 * the same component the gallery draws `#/design/camera` with, so the picture
 * is the whole screen and every control floats on it.
 *
 * **Nothing about taking a photograph moved.** `shoot` is the same function
 * against the same burst, the poll that watches the capture is the same
 * effect, the guide rectangle is still measured off `SLOT_GUIDE` and the crop
 * off `SLOT_CROP`, and `app/cameraSession.tsx` was not edited at all. The
 * shutter is still one `onClick` straight to `shoot`, with nothing in front of
 * it: see #294 for what work put behind other work costs.
 *
 * What did change is what floats on the picture. The row of navigation chips
 * along the top is gone, because the drawn screen has one way out and it is
 * the round target in the corner; the lens list, the diagnostics and the
 * handedness switch are behind the one target in the far corner, which is
 * where `design/Camera.tsx` says a switch pressed once ever belongs;
 * and the slot chips are `Shots`, which draws the photograph rather than a
 * lettered box, because a blurred photograph is the thing somebody needs to
 * see.
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

/*
 * Which edge the shutter is on used to be read and written here, because this
 * was the only screen that could ask. It is `lib/hand.ts` now (#350): the
 * settings screen asks the same question, and one answer read from two places
 * has to be spelled once or the two screens disagree about what somebody chose.
 */

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
    duplicates, duplicatesTurnedDown,
    setShots, setThumbs, setCrops, setExamined, setStatus, setActiveSlot,
    setCaptureId, setDuplicates, setDuplicatesTurnedDown,
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
        } else if (capture.status === 'failed') {
          if (capture.note) setError(capture.note)
          /*
           * And keep what the reading did get (#436).
           *
           * A barcode that decoded and a catalogue that has never heard of the
           * book is `failed`, and the digits are on the row. Saying so in a
           * banner and dropping them left the screen after this one headed
           * "Barcode on the back reads 9780030000126" over a field reading
           * "Not read yet", with nothing to do but type the number back in.
           * Nothing a person has answered is touched; see `applyReading`.
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
  }, [captureId, identified, applyLookup, applyReading, setDuplicates, setStatus, setError])

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

  /**
   * What the queue has made of each photograph, in words under its word.
   *
   * Only the two facts the photograph itself cannot show. That a photograph
   * exists is visible in the thumbnail, so "kept" would be the screen reading
   * itself back; that it is still being read, and that the ISBN came off it,
   * are not.
   */
  const noteOn = (slot: Slot): string | undefined => {
    if (status[slot] === 'busy') return 'reading'
    if (status[slot] === 'found') return 'ISBN found'
    return undefined
  }

  /*
   * The three photographs, in the order they are taken: the back first,
   * because it carries the barcode and the lookup starts on shot one.
   *
   * Pressing one points the shutter at that slot, which is what "take it
   * again" means on a camera: the next press of the shutter fills it.
   */
  const slotShots: Shot[] = SLOTS.map((slot) => ({
    word: SLOT_SHORT[slot],
    sliver: slot === 'edge',
    photo: thumbs[slot],
    next: activeSlot === slot,
    note: noteOn(slot),
    onPress: () => setActiveSlot(slot),
  }))

  /*
   * Where to hold the book, measured rather than drawn.
   *
   * The gallery's guide is a shape at fixed percentages. This one is the
   * rectangle in `SLOT_GUIDE`, which for the spine is the rectangle
   * `SLOT_CROP` really keeps, so what somebody frames is what survives. A
   * boundary you cannot see is a boundary you will get wrong.
   */
  const frame = SLOT_GUIDE[activeSlot]
  const guide = cameraOn && (
    <div
      className={SLOT_CROP[activeSlot] ? 'wf-view__guide wf-view__guide--slot' : 'wf-view__guide'}
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
          /* Only where there is a torch to offer, and only on the shot that
             wants it, so it is never a control somebody has to think past. */
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
          /* Lens choice, diagnostics and which hand holds the phone. All set
             once and then never touched, so the far corner is exactly where
             they belong and none of them earns permanent space.

             **It said "Settings" until #350**, which built a screen of that
             name. Two different things called Settings, one opening the app's
             and one opening a sheet about this camera, is the fault the design
             rules call two things sharing a name. It is called what its own
             sheet has always been headed, which is what it opens. */
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

            {/* Transient, and above the bottom band rather than inside it, so
                it costs nothing once it has faded. */}
            {toast && <div className="cam__toast">{toast}</div>}

            {/* The book in your hands is already in the queue (#146). Drawn
                over the viewfinder and nowhere near the shutter, because it is
                a finding and not a gate: the photograph has already been taken
                and accepted, and whether there are two copies of this book is
                not something a camera can know. */}
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
              What is in your hands, said rather than inferred from nothing
              being drawn (#62). Above the controls and out of the way of the
              picture: one line, and it is either the book the queue has
              settled on or the fact that there is not one yet.
            */}
            {identified ? (
              <p className="wf-view__found">
                <strong>{draft.title}</strong>
                {draft.authors ? ` · ${draft.authors}` : ''}
              </p>
            ) : shotCount === 0 && !captureId ? (
              <p className="wf-view__found wf-view__found--empty">
                Nothing in hand. First shot starts a new book.
              </p>
            ) : null}

            {!cameraOn && (
              <div className="wf-view__idle">
                <h2 className="wf-view__idle-head">Photograph the book</h2>
                <p className="wf-view__idle-said">
                  Back cover first, for the barcode. Then the front, then the spine.
                </p>
                <Button tone="primary" onPress={() => startCamera()}>Start camera</Button>
                {/* Vite prints eight addresses at startup and only some reach
                    a phone; the camera permission and the dev certificate
                    exception are both scoped to whichever one is actually
                    loaded, so a second device that once loaded a different
                    address needs to know which one it is on now (#60). */}
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
                    Which hand holds the phone. A person doing this has a book
                    in one hand, and the shutter has to be under the thumb of
                    the other one.

                    **The settings screen asks the same question since #350**,
                    which is where `design/Camera.tsx` always said it belonged:
                    "in the app it belongs beside the rest of the settings". It
                    stays here as well, because this is the one place somebody
                    discovers they need it, standing at a bookcase with the
                    shutter under the wrong thumb. It is not a second copy: both
                    read and write `lib/hand.ts`, so choosing here moves the
                    switch there and choosing there moves the shutter here.
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

                  {/* Written to be read out loud. Which lens, what it granted,
                      and how many pixels a spine actually arrives with cannot
                      be settled from here: nobody working on this owns the
                      phone (#92). So the phone answers, in words rather than in
                      a console. */}
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
      {/* The label the shutter carries is the slot it is about to fill, which
          is a fact only this screen knows. Said here rather than drawn: the
          button is a circle and always will be. */}
      <span className="wf-sr-only" aria-live="polite">
        Next photograph: {SLOT_LABEL[activeSlot]}
      </span>
    </div>
  )
}
