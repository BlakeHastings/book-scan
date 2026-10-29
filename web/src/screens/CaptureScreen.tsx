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

import { useEffect, useRef, useState } from 'react'
import {
  cameraAlreadyAllowed, cameraFactsText, currentOrigin, lensName, rememberTorch,
  SLOT_CROP, SLOT_GUIDE, SLOTS, SLOT_LABEL, SLOT_SHORT,
  thumbnail, type Slot,
} from '../lib/scanner'
import { captureSteadiest, describeBurst } from '../lib/steady'
import { rememberHand, rememberedHand } from '../lib/hand'
import { api, Refusal, type LookupResponse, type QueueMatch } from '../lib/api'
import { worthAskingAgain } from '../lib/photoUploads'
import { lastBookLine, lastBookSettled, looksLike } from '../lib/lastBook'
import { canShelve } from '../components/QueuePane'
import { QueuedNotice } from '../components/QueuedNotice'
import { Viewfinder, type Hand } from '../design/Camera'
import { Button } from '../design/Controls'
import type { Shot } from '../design/Shots'
import { evidenceOf, useBookInHand, type PhotoUploads } from '../app/bookInHand'
import { useCameraSession } from '../app/cameraSession'
import { useSummary } from '../app/summary'
import { useErrorBanner } from '../app/errorBanner'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

/**
 * What to say when a photograph did not reach the server: which one, that it
 * is not kept, and what to do. A refusal the server put into words says why;
 * a bare status from whatever stands in front of the server says nothing a
 * person can use, so it is not repeated.
 */
function didNotArrive(slot: string, caught: unknown): string {
  const said = caught instanceof Refusal && !worthAskingAgain(caught) && !/^\d{3}\b/.test(caught.message)
    ? ` The server said: ${caught.message}`
    : worthAskingAgain(caught)
      ? ' The connection or the server dropped it, even after trying again.'
      : ''
  return `The ${slot.toLowerCase()} did not reach the server, so it is not kept.${said} Take it again.`
}

/**
 * The book put down by "New book", asked about while the next one is
 * photographed. Its capture id is not known until its first photograph has
 * answered, so the uploads are kept to ask.
 */
interface LastBook {
  readonly captureId: number | null
  readonly uploads: PhotoUploads | null
}

/** How often the last book is asked about. Slower than the book in hand: it is a glance, not a gate. */
const LAST_BOOK_EVERY_MS = 2000

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
  /** The queue read every photograph of this capture and found no ISBN on any of them. */
  const [readNothing, setReadNothing] = useState(false)
  /** What was said about a photograph that did not arrive, by slot, so taking it again can take it back. */
  const undelivered = useRef<Partial<Record<Slot, string>>>({})
  /** Asking the browser whether the camera may open without a tap, so the button is not drawn meanwhile. */
  const [askingToStart, setAskingToStart] = useState(true)
  const [lastBook, setLastBook] = useState<LastBook | null>(null)
  const [lastLine, setLastLine] = useState('')

  const {
    draft, shots, thumbs, status, activeSlot, identified, captureId, saving,
    duplicates, duplicatesTurnedDown, catalogued, evidence,
    setShots, setThumbs, setCrops, setExamined, setStatus, setActiveSlot,
    setCaptureId, setDuplicates, setDuplicatesTurnedDown, setCatalogued, setEvidence,
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
  const sending = SLOTS.some((slot) => status[slot] === 'sending')
  const reading = SLOTS.some((slot) => status[slot] === 'reading')

  // The camera view is a fixed overlay, so the document behind it must not
  // scroll or iOS will rubber-band the whole page under the controls.
  useEffect(() => {
    document.body.classList.add('body--locked')
    return () => document.body.classList.remove('body--locked')
  }, [])

  /*
   * Open the camera without a tap where the browser has already said yes, so
   * coming back for the next book lands on a picture rather than a button. A
   * browser that would ask, or cannot say, gets the button, since a prompt
   * wants a tap behind it.
   *
   * Every way off this screen stops the camera itself, but one opened after
   * leaving would have nobody to stop it, so that case is caught here.
   */
  useEffect(() => {
    let left = false
    if (cameraOn) {
      setAskingToStart(false)
      return
    }
    void cameraAlreadyAllowed().then(async (allowed) => {
      if (left) return
      if (allowed) {
        await startCamera()
        if (left) stopCamera()
      }
      if (!left) setAskingToStart(false)
    })
    return () => { left = true }
    // Once per arrival on the camera: a camera stopped while here was stopped on purpose.
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
      // Pressed before the stream has drawn anything, which a quick thumb on
      // a camera that has only just started does. Nothing was lost.
      camera.setToast('The camera is still starting. Try again in a moment.')
      return
    }
    setBurstNote(describeBurst(scores, chosen, elapsedMs))

    // Taken with the frame in hand: "Next book" pressed while this photograph
    // travels puts this book down, and the answer must still land on this one.
    const uploads = book.photographsOnTheirWay()

    // Each of these only replaces what this photograph put there, so a slot
    // retaken, or a book put down, in the meantime is left alone.
    let shown = full
    const ours = (current: Partial<Record<Slot, string>>) =>
      current[slot] === full || current[slot] === shown
    const without = (current: Partial<Record<Slot, string>>) =>
      (ours(current) ? { ...current, [slot]: undefined } : current)

    setThumbs((current) => ({ ...current, [slot]: full }))
    // A fresh photo invalidates any existing crop, since a stale crop beside
    // a new photo is worse than none.
    setCrops((current) => ({ ...current, [slot]: undefined }))
    setExamined((current) => current.filter((seen) => seen !== slot))
    void thumbnail(full).then((small) => {
      setThumbs((current) => (ours(current) ? { ...current, [slot]: small } : current))
      shown = small
    })
    setStatus((current) => ({ ...current, [slot]: 'sending' }))
    setShots((current) => ({ ...current, [slot]: full }))
    setActiveSlot((current) => nextEmpty({ ...shots, [slot]: full }, current))

    try {
      const { capture, counts: queued } = await uploads.add(full, slot, captureId)
      setQueueCounts(queued)
      if (!book.stillHolding(uploads)) return
      setCaptureId(capture.id)
      // Arrived: from here the queue has it, and nothing waits on the reading.
      setStatus((current) => (current[slot] === 'sending' ? { ...current, [slot]: 'reading' } : current))
      const said = undelivered.current[slot]
      if (said) {
        delete undelivered.current[slot]
        setError((current) => (current === said ? '' : current))
      }
    } catch (caught) {
      if (!book.stillHolding(uploads)) {
        setError(
          `A ${SLOT_LABEL[slot].toLowerCase()} photograph of the last book did not reach `
          + 'the server, so that book is missing it. Find it in the queue to take it again.',
        )
        return
      }
      // The server never kept it, so the screen must not look as though it
      // did: the slot is empty again and next in line.
      setShots(without)
      setThumbs(without)
      setStatus((current) => (current[slot] === 'sending' ? { ...current, [slot]: undefined } : current))
      setActiveSlot(slot)
      const said = didNotArrive(SLOT_LABEL[slot], caught)
      undelivered.current[slot] = said
      setError(said)
    }
  }

  /**
   * Watch the capture the camera is filling, so the chips and the banner
   * reflect what the queue has actually read. Stops once it settles.
   */
  useEffect(() => {
    if (captureId === null) return

    let cancelled = false
    setReadNothing(false)
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
            // A slot taken again is on its way, and what was read is the old photograph.
            if (!read.has(slot) || next[slot] === 'sending') continue
            next[slot] = capture.isbn13 && slot === 'back' ? 'found' : 'kept'
          }
          return next
        })

        if (capture.status === 'ready' && capture.draft_json) {
          const looked = JSON.parse(capture.draft_json) as LookupResponse
          if (looked.found && !identified) applyLookup(looked, capture.isbn_source)
        }
        // Not an error on this screen: a back with no barcode, or a cover with
        // no ISBN printed on it, is ordinary, and the book is finished at
        // review either way. The note is carried there, as evidence, the
        // same as for a book opened from the queue.
        setReadNothing(capture.status === 'failed')
        setEvidence(evidenceOf(capture))
        if (capture.status === 'failed') {
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
    setDuplicates, setCatalogued, setStatus, setEvidence,
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
    if (!canShelve(match.capture)) return

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
    // Taken before the book is put down, which is what forgets it.
    setLastBook({ captureId, uploads: shotCount > 0 ? book.photographsOnTheirWay() : null })
    setLastLine(identified && draft.title ? `Last book: ${draft.title}, found` : '')
    // Whatever went wrong was about the book being put down.
    setError('')
    returnToOrigin()
  }

  /*
   * What became of the book put down last, said in a line while the next is
   * photographed, so somebody going quickly need not open the queue to know
   * the last one was read. Asked until there is nothing more to wait for.
   */
  useEffect(() => {
    if (!lastBook) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      const id = lastBook.captureId ?? lastBook.uploads?.captureId ?? null
      let line = lastBookLine(null)
      let settled = false
      if (id !== null) {
        try {
          const { capture } = await api.getCapture(id)
          line = lastBookLine(capture)
          settled = lastBookSettled(capture)
        } catch {
          // Asked again on the next turn; a glance is not worth an error.
          line = ''
        }
      }
      if (cancelled) return
      if (line) setLastLine(line)
      if (!settled) timer = setTimeout(() => void ask(), LAST_BOOK_EVERY_MS)
    }
    void ask()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [lastBook])

  /**
   * What the queue has made of each photograph. Only the facts the
   * photograph itself cannot show: that it has not reached the server yet,
   * that it is still being read, and that the ISBN came off it. Whether a photograph exists is already visible in
   * the thumbnail.
   */
  const noteOn = (slot: Slot): string | undefined => {
    if (status[slot] === 'sending') return 'sending'
    if (status[slot] === 'reading') return 'reading'
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
  /** A title the cover's search turned up, asked rather than told: nothing has confirmed it. */
  const guessed = identified ? '' : looksLike(evidence.suggestion)

  /** The one line about the book in hand. */
  const said = identified ? (
    <p className="wf-view__found">
      <strong>{draft.title}</strong>
      {draft.authors ? ` · ${draft.authors}` : ''}
    </p>
  ) : shotCount === 0 && !captureId ? (
    <p className="wf-view__found wf-view__found--empty">
      Nothing in hand. First shot starts a new book.
    </p>
  ) : guessed ? (
    <p className="wf-view__found" role="status">{guessed}</p>
  ) : readNothing && !sending && !reading ? (
    <p className="wf-view__found wf-view__found--empty" role="status">
      No ISBN read yet. The photographs are kept; finish the details at review.
    </p>
  ) : undefined

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

            {(queueDuplicates.length > 0 || catalogued) && (
              <div className="cam__findings">
                {/*
                  A line rather than a panel, with no way past it: two copies
                  of one book can genuinely happen, and the decision belongs at
                  the shelving step, not here.
                */}
                {catalogued && (
                  <p className="cam__catalogued" role="status">
                    <strong>Already catalogued</strong>
                    {` as #${catalogued.id} (${catalogued.title})`}
                    {catalogued.location ? ` at ${catalogued.location}` : ''}
                    . Saving it adds a second copy.
                  </p>
                )}

                {/* A finding, not a gate: the photograph is already taken and
                    accepted, and whether there are two copies is not something
                    a camera can decide. */}
                <QueuedNotice
                  matches={queueDuplicates}
                  onSame={(match) => void openQueuedInstead(match)}
                  onAnother={keepDespiteQueue}
                  disabled={saving}
                />
              </div>
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
                {/* Drawn only once the browser has said it would ask, so a
                    camera about to open by itself does not flash a button. */}
                {!askingToStart && (
                  <Button tone="primary" onPress={() => startCamera()}>Start camera</Button>
                )}
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
        said={(lastLine || said) ? (
          <>
            {lastLine && (
              <p className="cam__last" role="status">{lastLine}</p>
            )}
            {said}
          </>
        ) : undefined}
        also={{
          /* Dots for the three photographs rather than a count, which read
             as "book 3 of 3". */
          word: (
            <>
              New book
              <span className="cam__dots" aria-hidden="true">
                {SLOTS.map((slot) => (
                  <span key={slot} className={shots[slot] ? 'cam__dot cam__dot--taken' : 'cam__dot'} />
                ))}
              </span>
            </>
          ),
          onPress: nextBook,
          off: shotCount === 0,
        }}
        /* Waits for the photographs to arrive and never for them to be read:
           review takes the reading over when it lands. */
        done={sending ? 'Sending the photographs' : 'Done with this book'}
        doneOff={sending || (!identified && shotCount === 0 && !draft.title)}
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
