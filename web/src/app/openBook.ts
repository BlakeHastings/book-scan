/**
 * Picking a book up.
 *
 * Four screens hand a book to review, and they are the reason the book in hand
 * is shared at all: the library, the queue, the scanner and the camera. Each
 * of them says where the book came from and nothing else, because what can be
 * done to a book is decided by the book (#59).
 *
 * These live together rather than in the screens that call them so that the
 * two ways in stay one pair. A catalogued book and a queued capture are read
 * from different places and land on the same screen, and every field one of
 * them sets the other has to answer for.
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
   * Look at a book, which is not the same as picking it up (#315).
   *
   * `openBook` below hands a book to the review screen, which is where a record
   * is corrected. This opens the book's own page, which is about the book: what
   * it is, what can be done about it, and where it sits. Editing is one action
   * on that page rather than the whole of it, and it goes through `openBook`.
   *
   * Nothing is fetched here. The page reads what it needs, because most of what
   * it draws is not what a review needs and asking for it on the way in would
   * make every library tap wait for a book's whole history.
   */
  readonly viewBook: (id: number) => void
  readonly openBook: (id: number, from?: Origin) => Promise<void>
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
    // A different book is a different record and its actions are at the top of
    // the page. Landing halfway down somebody else's page reads as the tap not
    // having worked.
    window.scrollTo({ top: 0 })
    setRoute('book')
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
    book.endReviewSession()
    setError('')
    book.setNotice('')
    book.setOrigin(from)
    try {
      const { book: found, authors } = await api.getBook(id)
      const loaded = draftFromBook(found)
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
      // Reached from the shelves, not the queue: the anchor a previous book
      // left behind is not where this one goes back to. `from` above already
      // says where that is.
      setQueueReturn(null)
      setRoute('review')
    } catch (caught) {
      setError((caught as Error).message)
    }
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
    // What the photographs produced, carried through to the screen where
    // somebody has to work the book out. It is not laid over the draft: see
    // the state's own comment, and #147.
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
    // there, near where this capture sat. The scanner is not where this book
    // came from, whatever the last book on this screen arrived through.
    book.setOrigin('queue')
    book.setNotice('')
    setQueueReturn(anchor)
    setRoute('review')
  }

  /**
   * Open a book from the library, remembering where the library was.
   *
   * The anchor is kept in navigation rather than in ShelfView because ShelfView
   * is unmounted the moment the book opens, which is exactly why it cannot
   * remember anything itself. Same arrangement as the queue's (#47).
   */
  const openFromLibrary = (id: number, anchor: LibraryReturnAnchor) => {
    setLibraryReturn(anchor)
    void openBook(id, 'library')
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
    void openBook(id, book.origin)
  }

  return { viewBook, openBook, openCapture, openFromLibrary, openNeighbour }
}
