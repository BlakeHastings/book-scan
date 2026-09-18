/**
 * Picking a book up.
 *
 * Four screens hand a book to review: the library, the queue, the scanner
 * and the camera. Each says only where the book came from; what can be done
 * to it is decided by the book.
 *
 * These live together rather than in the screens that call them, since a
 * catalogued book and a queued capture are read from different places and
 * land on the same screen, and every field one of them sets the other has
 * to answer for.
 */

import { api, draftFromBook, draftFromCapture, type Capture, type LookupResponse } from '../lib/api'
import { filingName } from '../../shared/shelving'
import type { Slot } from '../lib/scanner'
import type { LibraryReturnAnchor } from '../components/ShelfView'
import type { QueueReturnAnchor } from '../components/QueuePane'
import { useBookInHand, type Origin } from './bookInHand'
import { useErrorBanner } from './errorBanner'
import { useNavigation } from './navigation'
import { useBrowsing } from './browsing'

export interface OpenBook {
  /**
   * Look at a book, which is not the same as picking it up. `openBook`
   * below hands a book to the review screen, where a record is corrected;
   * this opens the book's own page, about the book itself.
   *
   * Nothing is fetched here: the page reads what it needs, since most of
   * what it draws is not what a review needs.
   */
  readonly viewBook: (id: number) => void
  /** Resolves true once the book is in hand, false when it could not be read. */
  readonly openBook: (id: number, from?: Origin) => Promise<boolean>
  /**
   * Pick a book up in order to say where it now stands. There is one
   * screen that places a book, and this is the way to it: the same way a
   * newly scanned book and a book coming back off the table both reach it.
   */
  readonly moveBook: (id: number) => Promise<void>
  readonly openCapture: (capture: Capture, anchor: QueueReturnAnchor) => void
  readonly openFromLibrary: (id: number, anchor: LibraryReturnAnchor) => void
  readonly openNeighbour: (id: number) => void
}

export function useOpenBook(): OpenBook {
  const { setRoute, setQueueReturn, setLibraryReturn } = useNavigation()
  const { setError } = useErrorBanner()
  const { setViewing } = useBrowsing()
  const book = useBookInHand()

  const viewBook = (id: number) => {
    setError('')
    setViewing(id)
    // A different book is a different record; landing halfway down the
    // page would read as the tap not having worked.
    window.scrollTo({ top: 0 })
    setRoute('book')
  }

  /**
   * Open a catalogued book. `from` changes only the way out: back to the
   * library listing, or back to the scanner for the next book off the pile.
   *
   * Resolves false on failure, leaving the screen the caller was on:
   * `moveBook` below reads this so it never routes onward from a book that
   * was never picked up.
   */
  const openBook = async (id: number, from: Origin = 'library'): Promise<boolean> => {
    book.endReviewSession()
    setError('')
    book.setNotice('')
    book.setOrigin(from)
    try {
      const { book: found, authors } = await api.getBook(id)
      const loaded = draftFromBook(found)
      /*
       * A filing name the heuristic would not produce is an override, and
       * must survive the round trip or the book moves on save. Read off
       * the credit rather than the row, since that is the same value the
       * shelf is ordered by.
       */
      const derived = filingName(loaded.authors.split(',')[0]?.trim() ?? '')
      const files = authors[0]?.filingName ?? ''
      book.setDraft({
        ...loaded,
        authorFilingOverride: files && files !== derived ? files : '',
      })
      book.setBookId(id)
      book.setCheckedOutAt(found.checked_out_at)
      book.setCoverImage(found.cover_image ? `/api/covers/${found.cover_image}` : '')
      book.setCaptureId(null)
      book.setLookup(null)
      // A catalogued book has no capture behind it to quote.
      book.setEvidence({ coverText: '', note: '' })
      book.setIdentified(Boolean(found.isbn13))
      book.setThumbs({
        front: found.front_image ? `/api/covers/${found.front_image}` : undefined,
        back: found.back_image ? `/api/covers/${found.back_image}` : undefined,
        edge: found.edge_image ? `/api/covers/${found.edge_image}` : undefined,
      })
      book.setCrops({
        front: found.front_crop ? `/api/covers/${found.front_crop}` : undefined,
        back: found.back_crop ? `/api/covers/${found.back_crop}` : undefined,
        edge: found.edge_crop ? `/api/covers/${found.edge_crop}` : undefined,
      })
      book.setExamined((found.cropped ?? '').split(',').filter(Boolean) as Slot[])
      book.setShots({})
      // Reached from the shelves, not the queue: any anchor a previous book
      // left behind does not apply here.
      setQueueReturn(null)
      setRoute('review')
      return true
    } catch (caught) {
      setError((caught as Error).message)
      return false
    }
  }

  /** Pick a book up and go straight to the step that places one. See `moveBook`. */
  const moveBook = async (id: number) => {
    if (await openBook(id)) setRoute('shelve')
  }

  /**
   * Open a queue item in the review pane, pre-filled from its lookup and
   * from whatever anybody has already worked out about it. `draftFromCapture`
   * lays what a person stated over what the worker read, so somebody
   * picking a book up after somebody else put it down starts from their
   * work rather than the photographs again.
   */
  const openCapture = (capture: Capture, anchor: QueueReturnAnchor) => {
    book.endReviewSession()
    const looked = capture.draft_json
      ? (JSON.parse(capture.draft_json) as LookupResponse)
      : null
    const loaded = draftFromCapture(capture)

    book.setCaptureId(capture.id)
    book.setBookId(null)
    book.setLookup(looked)
    book.setIdentified(Boolean(loaded.title))
    book.setDraft(loaded)
    book.captureOnServerRef.current = loaded
    // What the photographs produced, carried through for reference. Not
    // laid over the draft; see the state's own comment.
    book.setEvidence({ coverText: capture.cover_text, note: capture.note })
    book.setThumbs({
      front: capture.front_image ? `/api/covers/${capture.front_image}` : undefined,
      back: capture.back_image ? `/api/covers/${capture.back_image}` : undefined,
      edge: capture.edge_image ? `/api/covers/${capture.edge_image}` : undefined,
    })
    // A capture is not cropped: the photo is being looked at to decide what
    // the book is, and that is the moment to see all of it.
    book.setCrops({})
    book.setExamined([])
    // The photos already live on the server; do not re-upload them on save.
    book.setShots({})
    // Came from the queue, so finishing or abandoning shelving lands back
    // there, regardless of where the previous book on this screen came from.
    book.setOrigin('queue')
    book.setNotice('')
    setQueueReturn(anchor)
    setRoute('review')
  }

  /**
   * Open a book from the library, remembering where the library was. The
   * anchor is kept in navigation rather than in `ShelfView`, since
   * `ShelfView` is unmounted the moment the book opens and could not
   * remember anything itself.
   */
  const openFromLibrary = (id: number, anchor: LibraryReturnAnchor) => {
    setLibraryReturn(anchor)
    void openBook(id, 'library')
  }

  /**
   * Jump from the book on screen to another one standing next to it. The
   * row drawn on the detail view is the shelf, so tapping a spine in it is
   * walking along the shelf rather than navigating away; where the way out
   * leads is unchanged.
   *
   * The library's memory of your place moves along with you, so leaving
   * lands on the book you ended on rather than the one you first opened.
   */
  const openNeighbour = (id: number) => {
    setLibraryReturn((current) => (current ? { ...current, bookId: id } : current))
    // A different book is a different record; landing halfway down the
    // page would read as the tap not having worked.
    window.scrollTo({ top: 0 })
    void openBook(id, book.origin)
  }

  return { viewBook, openBook, moveBook, openCapture, openFromLibrary, openNeighbour }
}
