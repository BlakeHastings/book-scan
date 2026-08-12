import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, deviceName, draftFromBook, draftFromCapture, draftFromLookup,
  editFromDraft, emptyDraft,
  type Capture, type CheckoutOutcome, type Counts, type Draft,
  type LookupResponse, type Misfile, type PlacementResponse, type QueueCounts,
  type QueueMatch,
} from './lib/api'
import { canTakeBack, findMisfile, recordMoved, takeMoveBack } from './lib/misfile'
import { putDownCapture, putDownOnPageHide, type HeldCapture } from './lib/leaveCapture'
import {
  applyFocusHints, cameraFacts, cameraFactsText, currentOrigin, describeStream,
  listLenses, openCamera, lensName, preferredLens, rememberedLens, rememberLens,
  rememberedTorch, rememberTorch, setTorch, torchAvailable,
  SLOT_CROP, SLOT_GUIDE, SLOT_GUIDE_LABEL, SLOTS, SLOT_HINT, SLOT_LABEL,
  SLOT_SHORT, stopStream, thumbnail, type CameraFact, type Lens, type Slot,
} from './lib/scanner'
import { captureSteadiest, describeBurst } from './lib/steady'
import { filingName, type ShelfRange } from '../shared/shelving'
import { rangeOfSlug } from '../domain/tagging/genre'
import { resolveIsbnPair } from '../shared/isbn'
import { bookStillInHand } from './lib/cameraReturn'
import { BookDetail } from './components/BookDetail'
import { PlacementView } from './components/ShelfStrip'
import { ShelfView, type LibraryReturnAnchor } from './components/ShelfView'
import { MoveRunView } from './components/MoveRunView'
import { ShelveView } from './components/ShelveView'
import { HomePane } from './components/HomePane'
import { canShelve, QueuePane, type QueueReturnAnchor } from './components/QueuePane'
import { ScanCamera } from './components/ScanCamera'
import { QueuedAlready } from './components/QueuedAlready'

type Mode = 'home' | 'capture' | 'review' | 'shelve' | 'library' | 'queue' | 'arrange'
type SlotStatus = 'empty' | 'busy' | 'found' | 'none' | 'kept'

/**
 * How the book on screen came to be there, which decides only where the way
 * out leads. What can be done to the book is decided by the book.
 *
 * `move` is the library too, and differs only in the way out: somebody
 * adjusting where a plank ends is working through the shelves, and dropping
 * them at the cataloguing camera when they finish would be the wrong room.
 */
type Origin = 'capture' | 'queue' | 'library' | 'scan' | 'move'

/**
 * Where finishing with a book puts you back.
 *
 * A table rather than a chain of conditionals, and one table rather than one
 * per exit. Finishing a book used to be answered in two places that knew
 * different halves of the question: one asked whether the book came from the
 * queue, the other whether it came from the scanner, and neither had heard of
 * the library. So putting a book back from the library ended at the
 * cataloguing camera, which is a room you then have to navigate out of (#89,
 * the same complaint as #47).
 *
 * Every origin appears here, so a new one cannot be added without saying where
 * it goes back to, and adding one no longer means finding every conditional
 * that would otherwise quietly treat it as "somewhere else".
 */
const RETURN_TO: Record<Origin, { mode: Mode; scanning?: boolean }> = {
  // Straight back to the viewfinder, so a pile of books is worked through
  // without a detour past the home screen.
  capture: { mode: 'capture' },
  queue: { mode: 'queue' },
  library: { mode: 'library' },
  move: { mode: 'library' },
  scan: { mode: 'home', scanning: true },
}

/** What actually happened when the shelf state was changed, in words. */
const CHECKOUT_SAID: Record<CheckoutOutcome, string> = {
  'checked-out': 'Checked out.',
  'already-out': 'It was already checked out, so nothing changed.',
  'checked-in': 'Checked in.',
  'already-in': 'It was already checked in, so nothing changed.',
}

/** Next slot with no photo in it, so the shutter advances by itself. */
function nextEmpty(shots: Partial<Record<Slot, string>>, from: Slot): Slot {
  const order = [...SLOTS.slice(SLOTS.indexOf(from) + 1), ...SLOTS]
  return order.find((slot) => !shots[slot]) ?? from
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Bumped every time review moves on to a different book: a new capture, a
  // different shelved book, or back out to the library. A relookup started
  // before the bump is still running against the old session, and its answer
  // must land nowhere once this has moved past it.
  const reviewSessionRef = useRef(0)
  /**
   * The queued capture as the server currently holds it, in draft form. What
   * the autosave below diffs against, so only fields somebody actually changed
   * are claimed as their decision. Null whenever the book on screen is not a
   * queued capture.
   */
  const captureOnServerRef = useRef<Draft | null>(null)

  const [mode, setMode] = useState<Mode>('home')
  const [cameraOn, setCameraOn] = useState(false)
  const [resolution, setResolution] = useState('')
  const [lenses, setLenses] = useState<Lens[]>([])
  const [lensId, setLensId] = useState(rememberedLens())
  const [focusNote, setFocusNote] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * The torch, offered only where the phone actually has one and only on the
   * spine, which is the shot that needs it. More light means a shorter
   * exposure means less blur, which is the one lever on steadiness that is
   * physical rather than statistical.
   */
  const [torchReady, setTorchReady] = useState(false)
  const [torchOn, setTorchOn] = useState(rememberedTorch())
  /** What the last burst did, read off the phone to settle whether it is worth it. */
  const [burstNote, setBurstNote] = useState('')
  const [facts, setFacts] = useState<CameraFact[]>([])
  const [factsCopied, setFactsCopied] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [shots, setShots] = useState<Partial<Record<Slot, string>>>({})
  const [thumbs, setThumbs] = useState<Partial<Record<Slot, string>>>({})
  /**
   * The same photos cut to the book, and which slots have been looked at.
   *
   * Only ever set from a saved book. Cropping happens on the server after a
   * save, so a capture still on the queue and a shot taken thirty seconds ago
   * have neither, and showing them whole is correct rather than a fallback.
   */
  const [crops, setCrops] = useState<Partial<Record<Slot, string>>>({})
  const [examined, setExamined] = useState<Slot[]>([])
  const [status, setStatus] = useState<Partial<Record<Slot, SlotStatus>>>({})
  const [activeSlot, setActiveSlot] = useState<Slot>('back')

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [lookup, setLookup] = useState<LookupResponse | null>(null)
  const [identified, setIdentified] = useState(false)
  const [placement, setPlacement] = useState<PlacementResponse | null>(null)
  const [placementStale, setPlacementStale] = useState(false)
  /**
   * This book's shelving-review entry, when the server reports one.
   *
   * Kept here rather than in BookDetail because BookDetail does not fetch:
   * everything it draws arrives as a prop, the same way the placement preview
   * beside this does.
   */
  const [misfile, setMisfile] = useState<Misfile | null>(null)
  /**
   * Whether that entry is a boundary move this app made and nobody acted on.
   *
   * Kept apart from `misfile` because they are answers to different questions.
   * The first is where the book is against where it belongs; this is how the
   * disagreement came about, and only one way of coming about it is anybody's
   * to withdraw.
   */
  const [misfileTakeable, setMisfileTakeable] = useState(false)
  const [misfileMoving, setMisfileMoving] = useState(false)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [relookupBusy, setRelookupBusy] = useState(false)
  const [relookupError, setRelookupError] = useState('')
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [captureId, setCaptureId] = useState<number | null>(null)
  /**
   * Captures already in the queue that the one being photographed appears to
   * be a second go at (#146).
   *
   * The server decides this, on the poll below, and by the ISBN first: the
   * back cover is the shot this camera opens on and it carries the barcode, so
   * usually there is an identifier long before there is anything worth
   * comparing pictures with. See `duplicatesOf` in server/index.ts.
   */
  const [duplicates, setDuplicates] = useState<QueueMatch[]>([])
  /**
   * Captures the person has been shown and turned down, by id.
   *
   * Without this the panel would come back on the next poll, one and a half
   * seconds after being dismissed, and there would be no way past an answer at
   * all. Two copies of one book genuinely exist, so there has to be one.
   */
  const [duplicatesTurnedDown, setDuplicatesTurnedDown] = useState<number[]>([])
  const [bookId, setBookId] = useState<number | null>(null)
  const [deletingBook, setDeletingBook] = useState(false)
  const [checkedOutAt, setCheckedOutAt] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)
  const [boundaryMoving, setBoundaryMoving] = useState(false)
  const [coverImage, setCoverImage] = useState('')
  const [scanning, setScanning] = useState(false)
  const [origin, setOrigin] = useState<Origin>('capture')
  /** What the last state change actually did, in the outcome's own words. */
  const [notice, setNotice] = useState('')
  // Where in the queue listing to land on the way back, since the book being
  // shelved leaves the queue behind and the row it sat in goes with it. The
  // queue is the origin itself; this is only the position within it.
  const [queueReturn, setQueueReturn] = useState<QueueReturnAnchor | null>(null)
  // Where the library was when a book was opened from it. Rows are long and
  // the page is a stack of them, so coming back to the top of the first
  // bookcase means finding your place again every time.
  const [libraryReturn, setLibraryReturn] = useState<LibraryReturnAnchor | null>(null)
  /*
   * Which run the arrange screen is about. Kept here for the reason the library
   * anchor is: ShelfView is unmounted the moment the screen changes, so the tab
   * it was on has to be carried out of it rather than asked for afterwards.
   */
  const [arranging, setArranging] = useState<ShelfRange>('fiction')
  /**
   * What a queued capture's photographs produced: the lines OCR read off the
   * cover, and the queue's note about why it could not settle the book.
   *
   * Held separately from the draft and never folded into it. It is evidence
   * for the person filling the form in rather than a value in it (#147), and
   * anything that put it in a field would be promoting a guess to a fact.
   */
  const [evidence, setEvidence] = useState({ coverText: '', note: '' })

  const derivedFiling = filingName(draft.authors.split(',')[0]?.trim() ?? '')
  /** What is still worth saying: found, and not already turned down. */
  const queueDuplicates = duplicates.filter(
    (match) => !duplicatesTurnedDown.includes(match.capture.id),
  )
  const shotCount = SLOTS.filter((slot) => shots[slot]).length
  const busy = SLOTS.some((slot) => status[slot] === 'busy')
  const fullScreenCamera = mode === 'capture'
  const me = deviceName()

  /*
   * The three facts "what is in my hands" is made of, mirrored into refs.
   *
   * The page-away listener below is registered once and fires much later, so
   * it cannot close over a render's values: it has to ask what is in hand at
   * the moment somebody leaves.
   */
  const draftRef = useRef(draft)
  draftRef.current = draft
  const captureIdRef = useRef(captureId)
  captureIdRef.current = captureId
  const bookIdRef = useRef(bookId)
  bookIdRef.current = bookId

  /**
   * The capture in hand, with whatever has been typed into it that the
   * autosave has not written yet.
   *
   * Null when there is no capture, and null for a catalogued book, which has
   * its own Save and holds no claim. A capture straight off the camera is
   * included even though nobody claimed it: releasing what you do not hold is
   * a no-op, and the typing is worth the same either way.
   */
  const heldCapture = useCallback((): HeldCapture | null => {
    const id = captureIdRef.current
    if (id === null || bookIdRef.current !== null) return null
    const onServer = captureOnServerRef.current
    return {
      id,
      who: me,
      edit: onServer ? editFromDraft(draftRef.current, onServer) : {},
    }
  }, [me])

  // Every way out that is not a tap: the browser's back button, the tab
  // closing, the phone putting the page away. See lib/leaveCapture.ts.
  useEffect(() => putDownOnPageHide(heldCapture), [heldCapture])

  useEffect(() => {
    api.health().then((h) => setCounts(h.counts)).catch(() => {})
    api.listCaptures().then((r) => setQueueCounts(r.counts)).catch(() => {})
  }, [mode])

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
      setTorchReady(torchAvailable(stream))
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

  /**
   * Light the spine, and only the spine.
   *
   * Following the slot rather than being a mode of its own means no extra tap:
   * the person picks the spine as they already do, and the light is on when
   * they get there. It goes out again on the covers, which are shot flat and
   * do not need it, and where a torch would only bounce off the artwork.
   */
  useEffect(() => {
    if (!cameraOn || !torchReady) return
    const wanted = torchOn && activeSlot === 'edge'
    void setTorch(streamRef.current, wanted)
    // Off on the way out, so closing the camera never leaves a phone lit up in
    // somebody's pocket.
    return () => { void setTorch(streamRef.current, false) }
  }, [activeSlot, cameraOn, torchOn, torchReady])

  // Read once the sheet is opened rather than on every render: getCapabilities
  // is a synchronous call into the capture device and this is a viewfinder.
  useEffect(() => {
    if (!settingsOpen) return
    setFacts(cameraFacts(streamRef.current, videoRef.current))
    setFactsCopied(false)
  }, [settingsOpen])

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

  /**
   * `isbnSource` comes from the capture rather than the lookup, because the
   * queue is the only thing that knows whether the digits were decoded from a
   * barcode or read off the page. Losing it here is what left every book
   * catalogued at the camera without a provenance.
   */
  const applyLookup = (result: LookupResponse, isbnSource: string) => {
    setLookup(result)
    setIdentified(true)
    setDraft((current) => ({
      ...draftFromLookup(result, isbnSource),
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
  }, [mode, captureId, identified])

  /**
   * Write what is being worked out back to the capture, while it is being
   * worked out.
   *
   * The point of the whole thing (#65): one person photographs, another
   * resolves details, a third shelves. That only works if the middle person's
   * work is durable, so it goes to the database as they type rather than
   * waiting for the book to be saved. Until this existed, corrections lived in
   * one browser tab and navigating away lost them, which forced resolving and
   * shelving to be one person in one sitting.
   *
   * Only for a queued capture. A catalogued book already has a Save, and a
   * book on the camera screen has no capture worth writing to yet.
   *
   * A difference is sent, not the whole draft: see `editFromDraft`. Failures
   * are swallowed on purpose, because the person is mid-sentence and an error
   * banner over a keystroke is worse than the next keystroke retrying, which
   * is what leaving the baseline untouched arranges.
   */
  useEffect(() => {
    if (mode !== 'review' || captureId === null || bookId !== null) return
    const onServer = captureOnServerRef.current
    if (!onServer) return

    const edit = editFromDraft(draft, onServer)
    if (!Object.keys(edit).length) return

    const timer = setTimeout(() => {
      const session = reviewSessionRef.current
      // Moved forward before the request so a second keystroke does not resend
      // the same fields, and put back if the write did not land.
      captureOnServerRef.current = draft
      void api.updateCapture(captureId, me, edit).catch(() => {
        if (reviewSessionRef.current === session) captureOnServerRef.current = onServer
      })
    }, 700)
    return () => clearTimeout(timer)
  }, [mode, captureId, bookId, draft, me])

  // -----------------------------------------------------------------------
  // Live placement preview
  // -----------------------------------------------------------------------

  const loadPlacement = useCallback(() => {
    return api.previewPlacement(draft, bookId ?? undefined)
      .then((result) => {
        setPlacement(result)
        setPlacementStale(false)
      })
      .catch((caught) => {
        // Nothing current to show, so nothing is shown. Leaving the last
        // answer up would draw a shelf, and let the shelving step name a
        // plank, that the app has no reason to believe is still true.
        setPlacement(null)
        setError((caught as Error).message)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same fields
    // the debounced effect below watches; draft as a whole changes on keystroke.
  }, [
    draft.title, draft.authors, draft.genre, draft.seriesName,
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
  // The misfile flag, for a book that is already on the shelves
  // -----------------------------------------------------------------------

  /**
   * Ask the server whether this book is where it belongs.
   *
   * The same read the library makes, `api.misfiles(range)`, and then this
   * book's row out of the answer. Deliberately not derived here by comparing
   * the recorded location against `placement.derivedLocation`, even though
   * both are already in hand: that comparison would flag books the real test
   * excludes, and there is one definition of a misfile (see src/lib/misfile.ts).
   *
   * Only for a catalogued book. A capture still being confirmed has no
   * recorded position for anything to disagree with.
   */
  const loadMisfile = useCallback(() => {
    if (bookId === null) {
      setMisfile(null)
      setMisfileTakeable(false)
      return Promise.resolve()
    }
    return api.misfiles(rangeOfSlug(draft.genre))
      .then((review) => {
        setMisfile(findMisfile(review, bookId))
        setMisfileTakeable(canTakeBack(review, bookId))
      })
      .catch((caught) => {
        // Nothing said rather than a banner nobody can act on: an unanswered
        // review is not evidence the book is fine, and the error already has
        // somewhere to be shown.
        setMisfile(null)
        setMisfileTakeable(false)
        setError((caught as Error).message)
      })
  }, [bookId, draft.genre])

  useEffect(() => {
    if (mode !== 'review') {
      setMisfile(null)
      setMisfileTakeable(false)
      return
    }
    void loadMisfile()
  }, [mode, loadMisfile])

  /**
   * Re-read everything on this page that describes where the book sits.
   *
   * The banner and the strip under it are two reads of one set of shelves:
   * `api.misfiles` decides whether the book is where it belongs, and the
   * placement preview draws the row it belongs in and says which boundary
   * moves are open. So an action that moves a book invalidates both, and
   * refreshing one leaves the picture contradicting the tap somebody just
   * made (#197): the book stayed drawn as a dashed hole in the shelf, on the
   * screen where they are standing at the bookcase checking they did it right.
   *
   * One call rather than two lines repeated at each caller, because the list
   * of things to re-read is exactly the list of things this page derives from
   * the shelves, and the next action that moves a book should have somewhere
   * to join rather than a third refresh to remember.
   */
  const reloadShelfState = useCallback(async () => {
    await Promise.all([loadMisfile(), refreshPlacement()])
  }, [loadMisfile, refreshPlacement])

  /**
   * The person says they have carried this book to where it belongs.
   *
   * Identical in meaning to the library's "Moved it", because it is the same
   * statement: somebody has been to the shelf. Nothing here decides that on
   * their behalf, and the flag is not cleared locally to make the banner go
   * away. The page is asked again afterwards, so what it then shows is the
   * server's answer about the book's new location rather than this screen
   * assuming its own write was the whole story.
   *
   * The library refreshes itself: ShelfView is unmounted while a book is open
   * and loads on mount, so going back re-reads the review.
   */
  const confirmMisfileMoved = async () => {
    if (!misfile) return
    setMisfileMoving(true)
    setError('')
    try {
      await recordMoved(misfile)
      await reloadShelfState()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setMisfileMoving(false)
    }
  }

  /**
   * The person says they never picked this book up, so the move goes back.
   *
   * The way out of the shelving step that was missing (#196), reached from the
   * same notice as "Moved it" and meaning the opposite of it: not "I have been
   * to the shelf" but "nobody went anywhere". So it writes no location, and the
   * page is read again afterwards, because the boundaries have moved and the
   * strip on it was drawn from where they were.
   */
  const takeMisfileBack = async () => {
    if (!misfile) return
    setMisfileMoving(true)
    setError('')
    try {
      await takeMoveBack(rangeOfSlug(draft.genre), misfile.book.id)
      await reloadShelfState()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setMisfileMoving(false)
    }
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /**
   * Bump the review session and drop whatever a relookup was doing, without
   * touching the book on screen otherwise.
   *
   * Every place that stops expecting a relookup's answer to still be welcome
   * used to repeat the same three lines by hand: bump the ref, clear
   * `relookupBusy`, clear `relookupError`. That duplication is exactly how
   * this bug happened, since ending an edit by saving it was never one of the
   * copies. One helper, called from all of them, so there is only one list to
   * keep complete.
   */
  const endReviewSession = () => {
    reviewSessionRef.current += 1
    setRelookupBusy(false)
    setRelookupError('')
  }

  /**
   * Replace the ISBN and refetch the record from the catalogue.
   *
   * The ISBN is the key everything else hangs off, so a misread digit makes
   * every other field wrong. Correcting it refetches rather than asking the
   * user to retype the metadata. Location and notes are kept: they are the
   * fields the person, not the catalogue, is the authority on.
   *
   * This runs while the user is looking at the detail view, not a modal, so it
   * can outlive the screen it was started from. The session token is read
   * before the request goes out and checked again after it comes back; if
   * review has since moved on to a different book, the answer is dropped
   * rather than landing on whatever is on screen by then.
   *
   * For a book still in the queue the correction goes through the capture
   * itself, which both persists it and runs the lookup in a single call. Two
   * calls would mean a browser closed in between leaves a capture carrying a
   * corrected ISBN and the old book's title. The ISBN is recorded as typed by
   * a person rather than read from a barcode or guessed by OCR, because that
   * is a third kind of fact and the record is worth less if it pretends
   * otherwise (#29).
   */
  const relookup = async (isbn: string) => {
    const session = reviewSessionRef.current
    const queued = captureId !== null && bookId === null
    setRelookupBusy(true)
    setRelookupError('')
    // Resolved up front so a failed request still has something valid to fall
    // back to: the digits the user typed, not whatever was there before.
    const typed = resolveIsbnPair(isbn)
    try {
      if (queued) {
        const { capture, lookup: found } = await api.updateCapture(
          captureId!, me, { isbn13: isbn },
        )
        if (reviewSessionRef.current !== session) return
        // The capture is now the authority: the server merged the lookup, the
        // typed digits and everything already stated into one row.
        const settled = draftFromCapture(capture)
        captureOnServerRef.current = settled
        setDraft(settled)
        // The row is the fresh one, and its note may have stopped being true:
        // "use Change ISBN" is stale advice to somebody who just did.
        setEvidence({ coverText: capture.cover_text, note: capture.note })
        setLookup(found)
        setIdentified(Boolean(found?.found))
        if (found && !found.found) {
          setError(
            `No catalogue has ${isbn}. The ISBN has been saved; fill the rest in by hand.`,
          )
        }
        return
      }

      const result = await api.lookupIsbn(isbn)
      if (reviewSessionRef.current !== session) return
      if (result.found) {
        setLookup(result)
        setIdentified(true)
        setDraft((current) => ({
          ...draftFromLookup(result, 'manual'),
          location: current.location,
          notes: current.notes,
        }))
      } else {
        // Record the corrected digits even when nothing matches, so the book
        // is not left carrying an ISBN we know to be wrong.
        setDraft((current) => ({
          ...current,
          isbn13: result.isbn13 || typed.isbn13 || isbn.replace(/[^0-9Xx]/g, ''),
          isbn10: result.isbn10 || typed.isbn10,
          isbnSource: 'manual',
        }))
        setError(
          `No catalogue has ${isbn}. The ISBN has been saved; fill the rest in by hand.`,
        )
      }
    } catch (caught) {
      if (reviewSessionRef.current !== session) return
      // The request failing is not a reason to make the user retype digits
      // they already got right, so what they typed is kept either way.
      if (typed.isbn13) {
        setDraft((current) => ({
          ...current,
          isbn13: typed.isbn13,
          isbn10: typed.isbn10,
          isbnSource: 'manual',
        }))
      }
      setRelookupError((caught as Error).message)
    } finally {
      if (reviewSessionRef.current === session) setRelookupBusy(false)
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
      // The one exit that ignores where the book came from, because the book
      // it came from no longer exists. The library is the only screen left
      // that makes sense to land on.
      clearBookInHand()
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
   *
   * `shelvedAt` is the shelf the person has just been told to put the book on
   * and answered "it fits" about. Empty for an ordinary edit, where nobody has
   * been anywhere near the shelves and the recorded location must be left
   * alone, along with whether the book is on the bookcase at all.
   *
   * That is the whole of what this knows about the physical world, and it is
   * carried by one value. Nothing here reads `checkedOutAt` to decide to write
   * anything: a save that used to check a book in on the strength of the book
   * being out is what destroyed take-down times, since editing a note is not a
   * statement about where a book is (#87). Both statements a placement makes
   * now travel with the label, in `api.updateAndShelve`.
   *
   * A new book needs nothing here: POST /api/books records where it landed as
   * part of the insert. Only the update path had the gap, and it is the path a
   * book takes every time it goes back on a shelf.
   */
  const persist = async (stay: boolean, shelvedAt = ''): Promise<boolean> => {
    setSaving(true)
    setError('')
    try {
      const result = bookId
        ? await api.updateAndShelve(bookId, draft, shelvedAt)
        : await api.saveBook(draft, shots, captureId ?? undefined)
      setCounts(result.counts)
      // Only the insert path reports queue counts; an edit does not touch it.
      if ('queue' in result) setQueueCounts(result.queue as QueueCounts)
      // result.placement is deliberately dropped. The server still recomputes
      // it at save time, but you have just come through the shelving step
      // with the book in your hand, so repeating the instruction over the
      // next book's viewfinder tells you nothing you did not act on.
      if (stay) {
        // Staying means the edit just written is the one still on screen: no
        // navigation happens, so nothing else bumps the session for it. A
        // relookup started before this save is no longer wanted once the
        // write it would have raced with has landed.
        endReviewSession()
        await refreshPlacement()
      } else {
        // Finished with the book, so back the way you came in: the scanner for
        // the next one off the pile, the shelves for the next adjustment, the
        // queue for the next capture, the library for the book you were just
        // looking at. reset() reads that off the origin rather than guessing.
        reset()
      }
      return true
    } catch (caught) {
      setError((caught as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  /**
   * Change whether the book is on the bookcase.
   *
   * Only ever from a tap on this book's own page, and it takes the id and the
   * direction the person asked for. Nothing derives the direction from the
   * state, and no photograph reaches this call.
   */
  const checkOut = async (out: boolean) => {
    if (bookId === null) return
    setCheckingOut(true)
    setError('')
    try {
      const result = await api.setCheckedOut(bookId, out)
      setCheckedOutAt(result.book.checked_out_at)
      setCounts(result.counts)
      // Said out loud, because two of the four outcomes change nothing at all
      // and a page that redraws identically looks like a tap that missed.
      setNotice(CHECKOUT_SAID[result.outcome])
      // The shelf has closed up behind it, so the drawing is stale.
      await refreshPlacement()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setCheckingOut(false)
    }
  }

  /**
   * A book the scanner recognised. It gets opened and nothing else.
   *
   * This is the whole of what scanning does. The detail view reads the book's
   * checked-out state and offers the actions that fit it, so the same landing
   * works for a book on the shelf and one in a pile on the table, and the
   * person picks. Starting a check-in here because the book happens to be out
   * was the original idea and is deferred until identification is measurably
   * better than it is (#49).
   */
  const openScanned = async (id: number) => {
    setScanning(false)
    await openBook(id, 'scan')
  }

  /**
   * A book the scanner recognised as one already in the queue (#122).
   *
   * Opening the capture somebody made, rather than starting a second one.
   * That is the whole value of the answer: the photographs already exist and
   * have already been read, so a second capture adds nothing but a duplicate
   * row for somebody to notice later, and noticing is the step that fails.
   * Two rows of the same book end either as the same book catalogued twice or
   * as a discard that takes the photographs of the real one with it.
   *
   * Claimed on the way in, through the same call the queue makes, because the
   * thing that stops two people filling in one book is the claim and not which
   * screen they arrived from. A capture still being read cannot be opened at
   * all, for the same reason the queue refuses: there is nothing yet to
   * confirm or correct.
   */
  const openWaiting = async (capture: Capture) => {
    if (!canShelve(capture)) {
      setToast('Still reading its photographs. Give it a moment and open it from the queue.')
      return
    }
    try {
      const { capture: claimed } = await api.claimCapture(capture.id, deviceName())
      setScanning(false)
      // The index is where to land if this capture leaves the queue while it
      // is open, and the scanner never saw the list it would be an index into.
      // The top of the queue is the honest answer to "near where it was".
      openCapture(claimed, { id: capture.id, index: 0 })
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

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
      setToast('Still reading its photographs. Give it a moment and open it from the queue.')
      return
    }

    const mine = captureId
    try {
      const { capture: claimed } = await api.claimCapture(match.capture.id, me)

      // Only now. These photographs are of a book that is already in the
      // queue, and the person has just said so, so the row they would leave
      // behind is the duplicate this whole answer exists to prevent.
      if (mine !== null) {
        const { counts } = await api.deleteCapture(mine)
        setQueueCounts(counts)
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
   * Move a boundary book on to the plank next door, through the shelving step.
   *
   * The boundary moves first and the book's recorded location does not, which
   * is the same shape the overflow cascade has always had: the furniture is
   * the app's to change, and where a book physically is only a person can say.
   * So the layout now puts this book on the next plank, the shelving step
   * names that plank because it derives it, and "It fits, save" writes it down
   * through the one route that changes a location.
   *
   * Backing out leaves the book reported as needing to move, which is the
   * truth: the shelves have been reorganised and the book has not been carried
   * yet. Moving it back is one tap from the same list.
   */
  const moveAcrossBoundary = async (
    range: ShelfRange,
    id: number,
    direction: 'next' | 'previous',
  ) => {
    await api.moveAcrossBoundary(range, id, direction)
    await openBook(id, 'move')

    /*
     * The placement in hand describes the shelves as they were a moment ago,
     * and the move has just changed them. It names the plank the book is
     * coming FROM, so handing it to the shelving step offers "It fits, save"
     * against the wrong label: the instruction reads "put it back where it
     * already was", and a tap answers it by writing that plank into
     * `location`. That is #105, and it lost the move somebody had just made.
     *
     * Dropped rather than left to be overwritten, because the reload below is
     * a round trip and the screen is on the shelving step before it lands.
     * With nothing there, ShelveView says it is still working out where the
     * book goes and refuses every answer, which is the same guard #79 put on
     * a placement that had not arrived yet.
     */
    setPlacement(null)
    setMode('shelve')
    await refreshPlacement()
  }

  /**
   * Start a boundary move from the book's own page (#96).
   *
   * The library used to offer this next to every area instead, which had to
   * make sense drawn three different ways (#82) and put a control next to
   * every book in a scrolling row, one mistap from moving the wrong one. The
   * detail view already derives its actions from the book's own state (#59),
   * and this is exactly that: an action available because of where this book
   * sits. `boundaryMoves` on the placement preview says which directions are
   * genuinely open; the server checks again on the write regardless.
   */
  const startBoundaryMove = async (direction: 'next' | 'previous') => {
    if (bookId === null) return
    setBoundaryMoving(true)
    setError('')
    try {
      await moveAcrossBoundary(rangeOfSlug(draft.genre), bookId, direction)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBoundaryMoving(false)
    }
  }

  // Named wrappers rather than passing persist straight to a handler: onClick
  // hands its callback a MouseEvent, which would arrive as a truthy `stay`.
  /** Finish shelving a book and hand the screen back to the camera. */
  const save = (shelvedAt = '') => persist(false, shelvedAt)

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
   * Open a catalogued book. Same detail view as a queued capture, so there is
   * one place a book is looked at and edited rather than two.
   *
   * `from` changes the way out and nothing else: back to the library listing
   * you were browsing, or back to the scanner for the next book off the pile.
   * Everything the page offers to do comes from the book itself.
   */
  const openBook = async (id: number, from: Origin = 'library') => {
    endReviewSession()
    setError('')
    setNotice('')
    setOrigin(from)
    try {
      const { book, authors } = await api.getBook(id)
      const loaded = draftFromBook(book)
      /*
       * A filing name the heuristic would not produce is an override, and must
       * survive the round trip or the book moves on save.
       *
       * Read off the credit rather than off the row (#227). What the
       * first-listed name files under is a fact about the alias, so this is the
       * model rather than a copy of it, and it is the same value the shelf is
       * ordered by.
       */
      const derived = filingName(loaded.authors.split(',')[0]?.trim() ?? '')
      const files = authors[0]?.filingName ?? ''
      setDraft({
        ...loaded,
        authorFilingOverride: files && files !== derived ? files : '',
      })
      setBookId(id)
      setCheckedOutAt(book.checked_out_at)
      setCoverImage(book.cover_image ? `/api/covers/${book.cover_image}` : '')
      setCaptureId(null)
      setLookup(null)
      // A catalogued book has no capture behind it to quote.
      setEvidence({ coverText: '', note: '' })
      setIdentified(Boolean(book.isbn13))
      setThumbs({
        front: book.front_image ? `/api/covers/${book.front_image}` : undefined,
        back: book.back_image ? `/api/covers/${book.back_image}` : undefined,
        edge: book.edge_image ? `/api/covers/${book.edge_image}` : undefined,
      })
      setCrops({
        front: book.front_crop ? `/api/covers/${book.front_crop}` : undefined,
        back: book.back_crop ? `/api/covers/${book.back_crop}` : undefined,
        edge: book.edge_crop ? `/api/covers/${book.edge_crop}` : undefined,
      })
      setExamined((book.cropped ?? '').split(',').filter(Boolean) as Slot[])
      setShots({})
      // Reached from the shelves, not the queue: the anchor a previous book
      // left behind is not where this one goes back to. `from` above already
      // says where that is.
      setQueueReturn(null)
      setMode('review')
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  /**
   * Open a book from the library, remembering where the library was.
   *
   * The anchor is kept here rather than in ShelfView because ShelfView is
   * unmounted the moment the book opens, which is exactly why it cannot
   * remember anything itself. Same arrangement as the queue's (#47).
   */
  const openFromLibrary = (id: number, anchor: LibraryReturnAnchor) => {
    setLibraryReturn(anchor)
    void openBook(id, 'library')
  }

  /**
   * Open the library on a particular run, from the top.
   *
   * The same anchor a book uses to come back, with no book in it: the library
   * opens on the tab it is given, finds nothing to scroll to, and reports the
   * anchor consumed. Which is exactly what leaving the arrange screen needs,
   * and is why it does not get a second mechanism.
   */
  const backToLibrary = (range: ShelfRange) => {
    setLibraryReturn({ range, bookId: 0, scrollY: 0 })
    setMode('library')
  }

  /**
   * Jump from the book on screen to another one standing next to it.
   *
   * The row drawn on the detail view is the shelf, so tapping a spine in it
   * is walking along the shelf rather than navigating away (#81). Where the
   * way out leads is unchanged: you are still in whatever you came from.
   *
   * The library's memory of your place moves along with you, so leaving lands
   * on the book you ended on rather than the one you first opened.
   */
  const openNeighbour = (id: number) => {
    setLibraryReturn((current) => (current ? { ...current, bookId: id } : current))
    // A different book is a different record, and its actions are at the top
    // of the page. Landing halfway down someone else's page reads as the tap
    // not having worked.
    window.scrollTo({ top: 0 })
    void openBook(id, origin)
  }

  /**
   * Open a queue item in the review pane, pre-filled from its lookup and from
   * whatever anybody has already worked out about it.
   *
   * This is the receiving half of the handoff: `draftFromCapture` lays what a
   * person stated over what the worker read, so somebody picking a book up
   * after somebody else put it down starts from their work rather than from
   * the photographs again.
   */
  const openCapture = (capture: Capture, anchor: QueueReturnAnchor) => {
    endReviewSession()
    const looked = capture.draft_json
      ? (JSON.parse(capture.draft_json) as LookupResponse)
      : null
    const loaded = draftFromCapture(capture)

    setCaptureId(capture.id)
    setBookId(null)
    setLookup(looked)
    setIdentified(Boolean(loaded.title))
    setDraft(loaded)
    captureOnServerRef.current = loaded
    // What the photographs produced, carried through to the screen where
    // somebody has to work the book out. It is not laid over the draft: see
    // the state's own comment, and #147.
    setEvidence({ coverText: capture.cover_text, note: capture.note })
    setThumbs({
      front: capture.front_image ? `/api/covers/${capture.front_image}` : undefined,
      back: capture.back_image ? `/api/covers/${capture.back_image}` : undefined,
      edge: capture.edge_image ? `/api/covers/${capture.edge_image}` : undefined,
    })
    // A capture is not cropped: the photo is being looked at to decide what
    // the book is, and that is the moment to see all of it.
    setCrops({})
    setExamined([])
    // The photos already live on the server; do not re-upload them on save.
    setShots({})
    // Came from the queue, so finishing or abandoning shelving lands back
    // there, near where this capture sat. The scanner is not where this book
    // came from, whatever the last book on this screen arrived through.
    setOrigin('queue')
    setNotice('')
    setQueueReturn(anchor)
    setMode('review')
  }

  /**
   * Put down whatever book is on screen: release its capture lock, bump the
   * review session so a relookup still in flight for it cannot land once it
   * has been left, and clear every field that describes it. Callers decide
   * where the screen goes next; `queueReturn` is deliberately not touched
   * here, since `reset` wants it to survive and `backToCamera` clears it
   * itself, see below.
   */
  const clearBookInHand = () => {
    endReviewSession()
    /*
     * Written down and handed back in one request; see lib/leaveCapture.ts.
     * What goes with it is whatever the autosave has not sent yet, which on
     * the way out is usually everything typed since the last pause, and used
     * to be dropped. An empty one still records that a person read this book
     * and left it as it was, which the queue needs in order to tell that
     * apart from a book nobody has opened.
     */
    const held = heldCapture()
    if (held) void putDownCapture(held)
    captureOnServerRef.current = null
    setDraft(emptyDraft)
    setLookup(null)
    setEvidence({ coverText: '', note: '' })
    setIdentified(false)
    setShots({})
    setThumbs({})
    setCrops({})
    setExamined([])
    setStatus({})
    setActiveSlot('back')
    setPlacement(null)
    setCaptureId(null)
    // Both halves of the queue answer belong to the capture that has just been
    // put down. Keeping the list would draw a finding about a book nobody is
    // holding; keeping what was turned down would carry one book's decision
    // over on to the next one.
    setDuplicates([])
    setDuplicatesTurnedDown([])
    setBookId(null)
    setCheckedOutAt(null)
    setCoverImage('')
    setNotice('')
    // Nothing in hand means the camera is where the next book comes from,
    // which is what the origin says once this one has been put down.
    setOrigin('capture')
  }

  /**
   * Put the book down and go back to wherever it was picked up.
   *
   * The one way out, shared by finishing shelving, by abandoning it, and by
   * leaving a catalogued book alone: they are all "done with this book"
   * moments, and they all owe the person the screen they started on. There
   * used to be two of these disagreeing about which screen that was.
   *
   * The origin is read before the book is put down, since putting it down is
   * what forgets where it came from. queueReturn survives on purpose; QueuePane
   * uses it once to land near the book just handled, then reports it consumed.
   */
  const reset = () => {
    const landing = RETURN_TO[origin]
    clearBookInHand()
    setMode(landing.mode)
    setScanning(Boolean(landing.scanning))
  }

  /**
   * Go somewhere else from the header: the Camera, Queue and Library tabs,
   * the "Book scan" title, and the "Back to camera" button in review.
   *
   * Every one of these is a way out of the book on screen, and until #150
   * only the Camera tab knew it. The others changed the mode and left the
   * capture claimed by somebody who had walked away, with what they had typed
   * still sitting in the browser. One function for all of them, so a fourth
   * destination cannot be added without the way out coming with it, which is
   * the same argument RETURN_TO above makes about where finishing lands you.
   *
   * Whether the book survives the trip is unchanged and is still
   * `bookStillInHand`'s call, see `lib/cameraReturn.ts` (#62): a plain camera
   * session is the one case where the book really is still in your hands.
   */
  const leaveFor = (next: Mode) => {
    if (!bookStillInHand(origin === 'queue', bookId)) {
      clearBookInHand()
      // Where in the queue listing the book sat, which is only any use to a
      // trip that ends in the queue. Going there by the tab lands near the
      // book just put down, the same as finishing with it does.
      if (next !== 'queue') setQueueReturn(null)
    }
    setMode(next)
  }

  // -----------------------------------------------------------------------
  // Full-screen camera
  // -----------------------------------------------------------------------

  // Above everything else: it is a full-screen camera, and whatever page
  // opened it is still behind waiting to be returned to.
  if (scanning) {
    return (
      <ScanCamera
        onIdentified={(id) => void openScanned(id)}
        onWaiting={(capture) => void openWaiting(capture)}
        onClose={() => { setScanning(false); setMode('home') }}
      />
    )
  }

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
          <button className="cam__chip-btn" onClick={() => { stopCamera(); setMode('home') }}>
            Home
          </button>
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
        <h1>
          <button className="topbar__home" onClick={() => leaveFor('home')}>
            Book scan
          </button>
        </h1>
        {/* Redundant on the home page, where the tiles say the same thing
            with room to explain themselves. */}
        {mode !== 'home' && (
        <nav>
          <button className="tab" onClick={() => leaveFor('capture')}>Camera</button>
          <button
            className={mode === 'queue' ? 'tab tab--on' : 'tab'}
            onClick={() => leaveFor('queue')}
          >
            Queue
          </button>
          <button
            className={mode === 'library' ? 'tab tab--on' : 'tab'}
            onClick={() => leaveFor('library')}
          >
            Library
          </button>
        </nav>
        )}
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
          stale={placementStale}
          range={rangeOfSlug(draft.genre)}
          title={draft.title || 'this book'}
          saving={saving}
          onShelved={(shelvedAt) => save(shelvedAt)}
          onBack={() => setMode('review')}
          onRefresh={refreshPlacement}
        />
      )}

      {mode === 'queue' && (
        <QueuePane
          onOpen={openCapture}
          onCounts={setQueueCounts}
          returnAnchor={queueReturn}
          onReturnAnchorConsumed={() => setQueueReturn(null)}
        />
      )}

      {mode === 'home' && (
        <HomePane
          counts={counts}
          queue={queueCounts}
          onAdd={() => setMode('capture')}
          onScan={() => setScanning(true)}
          onLibrary={() => setMode('library')}
          onQueue={() => setMode('queue')}
        />
      )}

      {mode === 'library' && (
        <ShelfView
          onOpen={openFromLibrary}
          returnAnchor={libraryReturn}
          onReturnAnchorConsumed={() => setLibraryReturn(null)}
          onArrange={(from) => { setArranging(from); setMode('arrange') }}
        />
      )}

      {/* Reached from the library and only from it, because the run somebody
          wants to move is the one they are looking at.

          Both ways out go back through the library's own return anchor, which
          is what puts it back on the run this screen was about. Landing on
          Fiction after moving non-fiction shows an empty needs-attention list
          and reads as the apply having done nothing. */}
      {mode === 'arrange' && (
        <MoveRunView
          range={arranging}
          onBack={() => backToLibrary(arranging)}
          onLibrary={() => backToLibrary(arranging)}
        />
      )}

      {mode === 'review' && (
        <main className="main">
          {notice && (
            <div className="warn warn--soft" onClick={() => setNotice('')}>{notice}</div>
          )}

          <BookDetail
            draft={draft}
            lookup={lookup}
            photos={thumbs}
            crops={crops}
            examined={examined}
            derivedFiling={derivedFiling}
            saving={saving}
            relookupBusy={relookupBusy}
            relookupError={relookupError}
            /* What the photographs read, shown beside the form as evidence
               and never poured into it (#147). */
            coverText={evidence.coverText}
            captureNote={evidence.note}
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
                onOpen={openNeighbour}
              />
            ) : undefined}
            doneLabel={
              bookId === null ? 'Done'
                : origin === 'scan' ? 'Scan another' : 'Back to library'
            }
            onShelve={() => setMode('shelve')}
            onSaveEdits={saveEdits}
            onDiscard={reset}
            shelfLabel={placement?.derivedLocation ?? ''}
            onDelete={bookId !== null ? deleteBook : undefined}
            deleting={deletingBook}
            /* A saved book has its cover on disk; one still being confirmed
               only has whatever the lookup just handed back. */
            catalogueCover={coverImage || lookup?.coverUrl || ''}
            checkedOutAt={checkedOutAt}
            onCheckOut={bookId !== null ? checkOut : undefined}
            checkingOut={checkingOut}
            boundaryMoves={placement?.strip?.boundary ?? null}
            onBoundaryMove={bookId !== null ? startBoundaryMove : undefined}
            boundaryMoving={boundaryMoving}
            misfile={misfile}
            onMisfileMoved={confirmMisfileMoved}
            onMisfileTakenBack={misfileTakeable ? takeMisfileBack : undefined}
            misfileMoving={misfileMoving}
          />

          {/* Only for a book still being scanned. A catalogued book came
              from the library and goes back there. */}
          {bookId === null && (
            <div className="actions">
              <button className="btn" onClick={() => leaveFor('capture')}>
                Back to camera
              </button>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
