/**
 * The book on screen, and everything that describes it.
 *
 * The app's one genuinely shared piece of state, because a book is carried
 * between screens rather than looked at on one: the camera fills the photographs
 * in, review fills the details in, the shelving step reads both and writes the
 * book down.
 *
 * Deliberately not in here: the camera's stream, lens and torch, which describe
 * a device and not a book (`cameraSession.tsx`); the catalogue's counts and lists
 * (`summary.tsx`); where in a listing to land on the way back
 * (`navigation.tsx`); and whether a delete or a check-out is in flight, which is
 * over before the screen it was tapped on can be left (`bookActions.ts`).
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import {
  api, deviceName, draftFromLookup, editFromDraft, emptyDraft, withReadIsbn,
  type Capture, type CataloguedBook, type Draft, type LookupResponse,
  type QueueMatch,
} from '../lib/api'
import { emptyCascade, walkedAway, type Cascade } from '../lib/cascade'
import { putDownCapture, putDownOnPageHide, type HeldCapture } from '../lib/leaveCapture'
import type { Slot } from '../lib/scanner'
import { useErrorBanner } from './errorBanner'
import { useNavigation } from './navigation'
import { useShelfState, type ShelfState } from './shelfState'

export type SlotStatus = 'empty' | 'busy' | 'found' | 'none' | 'kept'

/**
 * How the book on screen came to be there, which decides only where the way out
 * leads. What can be done to the book is decided by the book. `move` is the
 * library too, and differs only in the way out.
 */
export type Origin = 'capture' | 'queue' | 'library' | 'scan' | 'move'

/** What a queued capture's photographs produced, as evidence rather than as values. */
export interface Evidence {
  readonly coverText: string
  readonly note: string
}

export interface BookInHand extends ShelfState {
  /** This browser, as the queue names whoever is holding a capture. */
  readonly me: string

  readonly draft: Draft
  readonly setDraft: Dispatch<SetStateAction<Draft>>
  readonly lookup: LookupResponse | null
  readonly setLookup: Dispatch<SetStateAction<LookupResponse | null>>
  readonly identified: boolean
  readonly setIdentified: Dispatch<SetStateAction<boolean>>
  /**
   * The lines OCR read off the cover, and the queue's note about why it could not
   * settle the book. Held separately from the draft and never folded into it: it
   * is evidence for the person filling the form in rather than a value in it, and
   * anything that put it in a field would be promoting a guess to a fact.
   */
  readonly evidence: Evidence
  readonly setEvidence: Dispatch<SetStateAction<Evidence>>
  readonly coverImage: string
  readonly setCoverImage: Dispatch<SetStateAction<string>>

  readonly shots: Partial<Record<Slot, string>>
  readonly setShots: Dispatch<SetStateAction<Partial<Record<Slot, string>>>>
  readonly thumbs: Partial<Record<Slot, string>>
  readonly setThumbs: Dispatch<SetStateAction<Partial<Record<Slot, string>>>>
  /**
   * The same photos cut to the book, and which slots have been looked at. Only
   * ever set from a saved book, because cropping happens on the server after a
   * save, so showing a capture's photos whole is correct rather than a fallback.
   */
  readonly crops: Partial<Record<Slot, string>>
  readonly setCrops: Dispatch<SetStateAction<Partial<Record<Slot, string>>>>
  readonly examined: Slot[]
  readonly setExamined: Dispatch<SetStateAction<Slot[]>>
  readonly status: Partial<Record<Slot, SlotStatus>>
  readonly setStatus: Dispatch<SetStateAction<Partial<Record<Slot, SlotStatus>>>>
  readonly activeSlot: Slot
  readonly setActiveSlot: Dispatch<SetStateAction<Slot>>

  readonly captureId: number | null
  readonly setCaptureId: Dispatch<SetStateAction<number | null>>
  readonly bookId: number | null
  readonly setBookId: Dispatch<SetStateAction<number | null>>
  readonly checkedOutAt: string | null
  readonly setCheckedOutAt: Dispatch<SetStateAction<string | null>>

  /**
   * Captures already in the queue that the one being photographed appears to be a
   * second go at. The server decides this, on the camera's poll, and by the ISBN
   * first. See `duplicatesOf` in server/index.ts.
   */
  readonly duplicates: QueueMatch[]
  readonly setDuplicates: Dispatch<SetStateAction<QueueMatch[]>>
  /**
   * Captures the person has been shown and turned down, by id. Without this the
   * panel would come back on the next poll, a second and a half after being
   * dismissed, and two copies of one book genuinely exist.
   */
  readonly duplicatesTurnedDown: number[]
  readonly setDuplicatesTurnedDown: Dispatch<SetStateAction<number[]>>
  /**
   * The book the catalogue already holds under this capture's ISBN. A different
   * finding from `duplicates`, asked a different way: that one is about the queue
   * and this one about the shelves, and this one is asked of the ISBN alone.
   *
   * Filled by the camera's poll while somebody is photographing, and asked again
   * when a capture is opened from the queue, because the catalogue moves under it:
   * a book shelved this morning was not shelved when the photograph was read.
   */
  readonly catalogued: CataloguedBook | null
  readonly setCatalogued: Dispatch<SetStateAction<CataloguedBook | null>>

  readonly origin: Origin
  readonly setOrigin: Dispatch<SetStateAction<Origin>>
  /** What the last state change actually did, in the outcome's own words. */
  readonly notice: string
  readonly setNotice: Dispatch<SetStateAction<string>>
  readonly saving: boolean
  readonly setSaving: Dispatch<SetStateAction<boolean>>
  /**
   * A boundary move in flight, which outlives the screen it was started from,
   * unlike the flags local to `bookActions.ts`. The move sends you to the
   * shelving step and only clears once the placement has been read again, so
   * backing out during that window would find the buttons enabled if the flag
   * went away with the screen.
   */
  readonly boundaryMoving: boolean
  readonly setBoundaryMoving: Dispatch<SetStateAction<boolean>>
  /**
   * The shuffle a full plank started while this book was being placed. Here
   * rather than on the screen, because "Back to book details" unmounts the
   * shelving step and the list of confirmed rungs is the only place a person can
   * see what they have already carried.
   *
   * Cleared in `clearBookInHand` and nowhere else, so the shuffle lasts exactly
   * as long as the book it was made for.
   */
  readonly cascade: Cascade
  readonly setCascade: Dispatch<SetStateAction<Cascade>>

  readonly relookupBusy: boolean
  readonly setRelookupBusy: Dispatch<SetStateAction<boolean>>
  readonly relookupError: string
  readonly setRelookupError: Dispatch<SetStateAction<string>>

  /**
   * Bumped every time review moves on to a different book. A relookup started
   * before the bump is still running against the old session, and its answer must
   * land nowhere once this has moved past it.
   */
  readonly reviewSessionRef: React.MutableRefObject<number>
  /**
   * The queued capture as the server currently holds it, in draft form. What
   * the autosave diffs against, so only fields somebody actually changed are
   * claimed as their decision. Null whenever the book on screen is not a
   * queued capture.
   */
  readonly captureOnServerRef: React.MutableRefObject<Draft | null>

  readonly endReviewSession: () => void
  readonly clearBookInHand: () => void
  readonly applyLookup: (result: LookupResponse, isbnSource: string) => void
  /** What a reading produced when no catalogue answered: the ISBN and nothing else. */
  readonly applyReading: (capture: Capture) => void
}

const Context = createContext<BookInHand | null>(null)

export function BookInHandProvider({ children }: { children: ReactNode }) {
  const { route } = useNavigation()
  const { setError } = useErrorBanner()

  const reviewSessionRef = useRef(0)
  const captureOnServerRef = useRef<Draft | null>(null)

  const [shots, setShots] = useState<Partial<Record<Slot, string>>>({})
  const [thumbs, setThumbs] = useState<Partial<Record<Slot, string>>>({})
  const [crops, setCrops] = useState<Partial<Record<Slot, string>>>({})
  const [examined, setExamined] = useState<Slot[]>([])
  const [status, setStatus] = useState<Partial<Record<Slot, SlotStatus>>>({})
  const [activeSlot, setActiveSlot] = useState<Slot>('back')

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [lookup, setLookup] = useState<LookupResponse | null>(null)
  const [identified, setIdentified] = useState(false)
  const [evidence, setEvidence] = useState<Evidence>({ coverText: '', note: '' })
  const [coverImage, setCoverImage] = useState('')

  const [captureId, setCaptureId] = useState<number | null>(null)
  const [bookId, setBookId] = useState<number | null>(null)
  const [checkedOutAt, setCheckedOutAt] = useState<string | null>(null)

  const [duplicates, setDuplicates] = useState<QueueMatch[]>([])
  const [duplicatesTurnedDown, setDuplicatesTurnedDown] = useState<number[]>([])
  const [catalogued, setCatalogued] = useState<CataloguedBook | null>(null)

  const [origin, setOrigin] = useState<Origin>('capture')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [boundaryMoving, setBoundaryMoving] = useState(false)
  const [cascade, setCascade] = useState<Cascade>(emptyCascade)
  const [relookupBusy, setRelookupBusy] = useState(false)
  const [relookupError, setRelookupError] = useState('')

  const shelf = useShelfState(route, draft, bookId, setError)
  const { setPlacement } = shelf

  const me = deviceName()

  /*
   * The three facts "what is in my hands" is made of, mirrored into refs. The
   * page-away listener below is registered once and fires much later, so it
   * cannot close over a render's values: it has to ask what is in hand at the
   * moment somebody leaves.
   */
  const draftRef = useRef(draft)
  draftRef.current = draft
  const captureIdRef = useRef(captureId)
  captureIdRef.current = captureId
  const bookIdRef = useRef(bookId)
  bookIdRef.current = bookId

  /**
   * The capture in hand, with whatever has been typed into it that the autosave
   * has not written yet. Null when there is no capture, and null for a catalogued
   * book, which has its own Save and holds no claim. A capture straight off the
   * camera is included even though nobody claimed it, because releasing what you
   * do not hold is a no-op.
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

  /*
   * Leaving the shelving step closes the questions it had open, and keeps what was
   * carried. See `walkedAway`. Keyed on the route rather than hung off the
   * screen's own unmount, so every way out is covered by one line, and idempotent,
   * which a cleanup would not have been under `StrictMode`.
   */
  useEffect(() => {
    if (route !== 'shelve') setCascade(walkedAway)
  }, [route])

  /**
   * Write what is being worked out back to the capture, while it is being worked
   * out, so the middle person's work is durable across a handoff rather than
   * living in one browser tab. Only for a queued capture: a catalogued book
   * already has a Save, and a book on the camera screen has no capture worth
   * writing to yet.
   *
   * A difference is sent, not the whole draft: see `editFromDraft`. Failures are
   * swallowed on purpose, because leaving the baseline untouched is what makes the
   * next keystroke retry.
   */
  useEffect(() => {
    if (route !== 'review' || captureId === null || bookId !== null) return
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
  }, [route, captureId, bookId, draft, me])

  /**
   * Bump the review session and drop whatever a relookup was doing, without
   * touching the book on screen otherwise. One helper, called from every place
   * that stops expecting a relookup's answer to still be welcome, so there is only
   * one list to keep complete.
   */
  const endReviewSession = () => {
    reviewSessionRef.current += 1
    setRelookupBusy(false)
    setRelookupError('')
  }

  /**
   * `isbnSource` comes from the capture rather than the lookup, because the queue
   * is the only thing that knows whether the digits were decoded from a barcode or
   * read off the page.
   */
  const applyLookup = useCallback((result: LookupResponse, isbnSource: string) => {
    setLookup(result)
    setIdentified(true)
    setDraft((current) => ({
      ...draftFromLookup(result, isbnSource),
      location: current.location,
      notes: current.notes,
    }))
  }, [])

  /**
   * Take what the reading produced when no catalogue answered for it. A reading
   * that ends in `failed` still read something, and the common case is a barcode
   * that decoded perfectly for a book nothing anywhere has.
   *
   * Only the identifier, and only into a field nobody has answered. There is no
   * title and no author here on purpose: a lookup found nothing, and what OCR read
   * off the cover is evidence rather than an answer. A person's typing wins over a
   * background pass that lands behind it.
   */
  const applyReading = useCallback((capture: Capture) => {
    setDraft((current) => withReadIsbn(current, capture))
  }, [])

  /**
   * Put down whatever book is on screen: release its capture lock, bump the review
   * session so a relookup still in flight for it cannot land once it has been
   * left, and clear every field that describes it. Callers decide where the screen
   * goes next; `queueReturn` is deliberately not touched here, since returning to
   * the origin wants it to survive and `leaveFor` clears it itself. See
   * `leaving.ts`.
   */
  const clearBookInHand = () => {
    endReviewSession()
    /*
     * Written down and handed back in one request; see lib/leaveCapture.ts. What
     * goes with it is whatever the autosave has not sent yet. An empty one still
     * records that a person read this book and left it as it was, which the queue
     * needs in order to tell that apart from a book nobody has opened.
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
    // And the shelf half of the same answer: it names a book the person is no
    // longer holding, so carrying it on would warn about the wrong book.
    setCatalogued(null)
    setBookId(null)
    setCheckedOutAt(null)
    setCoverImage('')
    setNotice('')
    // The shuffle belonged to the book being placed, so it goes down with it.
    // What it recorded is on the shelves and in the catalogue either way, because
    // every rung was written as it was confirmed.
    setCascade(emptyCascade)
    // Nothing in hand means the camera is where the next book comes from.
    setOrigin('capture')
  }

  return (
    <Context.Provider
      value={{
        ...shelf,
        me,
        draft, setDraft,
        lookup, setLookup,
        identified, setIdentified,
        evidence, setEvidence,
        coverImage, setCoverImage,
        shots, setShots,
        thumbs, setThumbs,
        crops, setCrops,
        examined, setExamined,
        status, setStatus,
        activeSlot, setActiveSlot,
        captureId, setCaptureId,
        bookId, setBookId,
        checkedOutAt, setCheckedOutAt,
        duplicates, setDuplicates,
        duplicatesTurnedDown, setDuplicatesTurnedDown,
        catalogued, setCatalogued,
        origin, setOrigin,
        notice, setNotice,
        saving, setSaving,
        boundaryMoving, setBoundaryMoving,
        cascade, setCascade,
        relookupBusy, setRelookupBusy,
        relookupError, setRelookupError,
        reviewSessionRef,
        captureOnServerRef,
        endReviewSession,
        clearBookInHand,
        applyLookup,
        applyReading,
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useBookInHand(): BookInHand {
  const found = useContext(Context)
  if (!found) throw new Error('useBookInHand was called outside BookInHandProvider')
  return found
}
