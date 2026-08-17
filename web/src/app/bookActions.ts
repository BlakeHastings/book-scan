/**
 * Everything a person can do to the book on screen.
 *
 * Read by review and by the shelving step, which are the two screens a book
 * is acted on from. They are here rather than in either screen because they
 * are shared by both, and because they compose four things at once: the book,
 * the counts the write moves, where the screen goes afterwards, and the error
 * line. Splitting them per screen would mean two copies of `persist`, and
 * `persist` is the one function that writes a book down.
 */

import { useState } from 'react'
import {
  api, draftFromCapture, draftFromLookup,
  type CheckoutOutcome, type QueueCounts,
} from '../lib/api'
import { resolveIsbnPair } from '../../shared/isbn'
import { rangeOfSlug } from '../../domain/tagging/genre'
import type { ShelfRange } from '../../shared/shelving'
import { useBookInHand } from './bookInHand'
import { useSummary } from './summary'
import { useErrorBanner } from './errorBanner'
import { useLeaving } from './leaving'
import { useNavigation } from './navigation'
import { useOpenBook } from './openBook'

/** What actually happened when the shelf state was changed, in words. */
const CHECKOUT_SAID: Record<CheckoutOutcome, string> = {
  'checked-out': 'Checked out.',
  'already-out': 'It was already checked out, so nothing changed.',
  'checked-in': 'Checked in.',
  'already-in': 'It was already checked in, so nothing changed.',
}

/**
 * Where a finished save leaves you.
 *
 * `origin` is where the book was picked up: the queue, the library, the
 * scanner. `here` is the shelving step keeping the screen so it can say the
 * book is on the shelf, which is the end of the drawn journey and only makes
 * sense for a book that was not in the catalogue a moment ago. A book being
 * checked back in or carried across a boundary came from somewhere and owes
 * that screen a return.
 */
export type Landing = 'origin' | 'here'

export interface BookActions {
  /**
   * Finish shelving a book, and go wherever the landing says.
   *
   * `shelvedAt` is the plank the person just said the book fits on, or null for
   * an edit nobody made a statement about the room in. The plank rather than its
   * name, for the reason `ShelveView.onShelved` gives (#359).
   */
  readonly save: (shelvedAt?: number | null, land?: Landing) => Promise<boolean>
  /** Write edits to a catalogued book without leaving it. */
  readonly saveEdits: () => Promise<boolean>
  readonly deleteBook: () => Promise<void>
  readonly checkOut: (out: boolean) => Promise<void>
  readonly relookup: (isbn: string) => Promise<void>
  readonly startBoundaryMove: (direction: 'next' | 'previous') => Promise<void>
  readonly deletingBook: boolean
  readonly checkingOut: boolean
  readonly boundaryMoving: boolean
}

export function useBookActions(): BookActions {
  const { setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const { setCounts, setQueueCounts } = useSummary()
  const { returnToOrigin } = useLeaving()
  const { openBook } = useOpenBook()
  const book = useBookInHand()

  /*
   * Two "this action is in flight" flags, and they are local on purpose. Each
   * one is read by exactly one button on the book's own page, and each settles
   * before the screen it is drawn on can be left, so neither is shared with
   * anything.
   *
   * The two that are not here are the two that outlive this hook: `saving`,
   * which the shelving step draws too, and `boundaryMoving`, which is still
   * true while the move it started is navigating. Both are on the book in hand.
   */
  const [deletingBook, setDeletingBook] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)

  const {
    bookId, captureId, draft, shots, me,
    endReviewSession, clearBookInHand, refreshPlacement, setPlacement,
    boundaryMoving, setBoundaryMoving,
  } = book

  /**
   * Write the book. `stay` is the difference between finishing a new book,
   * which hands the screen back to the camera for the next one, and editing a
   * catalogued book, where throwing you out to the camera would be absurd.
   *
   * `shelvedAt` is the plank the person has just been told to put the book on
   * and answered "it fits" about. Null for an ordinary edit, where nobody has
   * been anywhere near the shelves and the recorded location must be left
   * alone, along with whether the book is on the bookcase at all.
   *
   * That is the whole of what this knows about the physical world, and it is
   * carried by one value. Nothing here reads `checkedOutAt` to decide to write
   * anything: a save that used to check a book in on the strength of the book
   * being out is what destroyed take-down times, since editing a note is not a
   * statement about where a book is (#87). Both statements a placement makes
   * now travel with the plank, in `api.updateAndShelve`.
   *
   * A new book needs nothing here: POST /api/books records where it landed as
   * part of the insert. Only the update path had the gap, and it is the path a
   * book takes every time it goes back on a shelf.
   */
  const persist = async (
    stay: boolean,
    shelvedAt: number | null = null,
    land: Landing = 'origin',
  ): Promise<boolean> => {
    book.setSaving(true)
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
      } else if (land === 'here') {
        /*
         * The shelving step keeps the screen so it can say the book is on the
         * shelf. The book stays in hand for exactly that one screen, and both
         * of its answers put it down: "next book" goes back where this one
         * came from, and "that is enough for today" goes to the first screen.
         * Nothing is held open that a tap does not close, and the capture is
         * released by the same `clearBookInHand` either way.
         */
        endReviewSession()
      } else {
        // Finished with the book, so back the way you came in: the scanner for
        // the next one off the pile, the shelves for the next adjustment, the
        // queue for the next capture, the library for the book you were just
        // looking at. returnToOrigin reads that off the origin rather than
        // guessing.
        returnToOrigin()
      }
      return true
    } catch (caught) {
      setError((caught as Error).message)
      return false
    } finally {
      book.setSaving(false)
    }
  }

  // Named wrappers rather than passing persist straight to a handler: onClick
  // hands its callback a MouseEvent, which would arrive as a truthy `stay`.
  /** Finish shelving a book, and go wherever the landing says. */
  const save = (shelvedAt: number | null = null, land: Landing = 'origin') =>
    persist(false, shelvedAt, land)

  /** Write edits to a catalogued book without leaving it. */
  const saveEdits = () => persist(true)

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
      setRoute('library')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setDeletingBook(false)
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
      book.setCheckedOutAt(result.book.checked_out_at)
      setCounts(result.counts)
      // Said out loud, because two of the four outcomes change nothing at all
      // and a page that redraws identically looks like a tap that missed.
      book.setNotice(CHECKOUT_SAID[result.outcome])
      // The shelf has closed up behind it, so the drawing is stale.
      await refreshPlacement()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setCheckingOut(false)
    }
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
    const session = book.reviewSessionRef.current
    const queued = captureId !== null && bookId === null
    book.setRelookupBusy(true)
    book.setRelookupError('')
    // Resolved up front so a failed request still has something valid to fall
    // back to: the digits the user typed, not whatever was there before.
    const typed = resolveIsbnPair(isbn)
    try {
      if (queued) {
        const { capture, lookup: found } = await api.updateCapture(
          captureId!, me, { isbn13: isbn },
        )
        if (book.reviewSessionRef.current !== session) return
        // The capture is now the authority: the server merged the lookup, the
        // typed digits and everything already stated into one row.
        const settled = draftFromCapture(capture)
        book.captureOnServerRef.current = settled
        book.setDraft(settled)
        // The row is the fresh one, and its note may have stopped being true:
        // "use Change ISBN" is stale advice to somebody who just did.
        book.setEvidence({ coverText: capture.cover_text, note: capture.note })
        book.setLookup(found)
        book.setIdentified(Boolean(found?.found))
        if (found && !found.found) {
          setError(
            `No catalogue has ${isbn}. The ISBN has been saved; fill the rest in by hand.`,
          )
        }
        return
      }

      const result = await api.lookupIsbn(isbn)
      if (book.reviewSessionRef.current !== session) return
      if (result.found) {
        book.setLookup(result)
        book.setIdentified(true)
        book.setDraft((current) => ({
          ...draftFromLookup(result, 'manual'),
          location: current.location,
          notes: current.notes,
        }))
      } else {
        // Record the corrected digits even when nothing matches, so the book
        // is not left carrying an ISBN we know to be wrong.
        book.setDraft((current) => ({
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
      if (book.reviewSessionRef.current !== session) return
      // The request failing is not a reason to make the user retype digits
      // they already got right, so what they typed is kept either way.
      if (typed.isbn13) {
        book.setDraft((current) => ({
          ...current,
          isbn13: typed.isbn13,
          isbn10: typed.isbn10,
          isbnSource: 'manual',
        }))
      }
      book.setRelookupError((caught as Error).message)
    } finally {
      if (book.reviewSessionRef.current === session) book.setRelookupBusy(false)
    }
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
    setRoute('shelve')
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
    // A book no genre tag claims is in neither run, so there is no boundary of
    // one for it to cross (#304). Nothing offers this for such a book; the
    // guard is here because the range is what the write is addressed to.
    const range = rangeOfSlug(draft.genre)
    if (bookId === null || range === null) return
    setBoundaryMoving(true)
    setError('')
    try {
      await moveAcrossBoundary(range, bookId, direction)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBoundaryMoving(false)
    }
  }

  return {
    save, saveEdits, deleteBook, checkOut, relookup, startBoundaryMove,
    deletingBook, checkingOut, boundaryMoving,
  }
}
