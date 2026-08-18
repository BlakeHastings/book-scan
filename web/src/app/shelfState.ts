/**
 * What the shelves say about the book in hand.
 *
 * Two reads of one set of shelves: the placement preview, which draws the row
 * the book belongs in and says which boundary moves are open, and the misfile
 * flag, which says whether the book is where it belongs. They are kept
 * together because an action that moves a book invalidates both, and because
 * `reloadShelfState` is the one call that re-reads them (#197).
 *
 * Owned by the book in hand rather than by a screen: review and the shelving
 * step are two views of the same answer, and moving between them must not
 * throw it away and fetch it again.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { api, type Draft, type Misfile, type PlacementResponse } from '../lib/api'
import { findMisfile } from '../lib/misfile'
import { rangeOfSlug } from '../../domain/tagging/genre'
import type { Route } from './navigation'

export interface ShelfState {
  readonly placement: PlacementResponse | null
  readonly setPlacement: Dispatch<SetStateAction<PlacementResponse | null>>
  readonly placementStale: boolean
  /** After books have physically moved, so the drawn shelf matches the shelf. */
  readonly refreshPlacement: () => Promise<void>
  readonly misfile: Misfile | null
}

export function useShelfState(
  route: Route,
  draft: Draft,
  bookId: number | null,
  setError: Dispatch<SetStateAction<string>>,
): ShelfState {
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

  const loadPlacement = useCallback(() => {
    /*
     * A book nothing files has nowhere to be placed, so nothing is asked (#304).
     *
     * The server refuses the same request for the same reason, and asking it
     * anyway would put an error banner over a screen that is not in error: the
     * app knows perfectly well why there is no answer, and `ShelveView` says
     * so. Cleared rather than left, because a placement worked out before
     * somebody unset the genre names a plank that no longer follows from
     * anything.
     */
    if (rangeOfSlug(draft.genre) === null) {
      setPlacement(null)
      setPlacementStale(false)
      return Promise.resolve()
    }
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
    draft.seriesIndex, draft.authorFilingOverride, bookId, setError,
  ])

  /** After books have physically moved, so the drawn shelf matches the shelf. */
  const refreshPlacement = useCallback(() => {
    setPlacementStale(true)
    return loadPlacement()
  }, [loadPlacement])

  useEffect(() => {
    if ((route !== 'review' && route !== 'shelve') || !draft.title.trim()) {
      setPlacement(null)
      return
    }
    setPlacementStale(true)
    const timer = setTimeout(loadPlacement, 250)
    return () => clearTimeout(timer)
  }, [route, draft.title, loadPlacement])

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
    // A book in neither run is in neither review: the question is whether it is
    // where its sort order puts it, and it has no sort order to be in (#304).
    const range = rangeOfSlug(draft.genre)
    if (bookId === null || range === null) {
      setMisfile(null)
      return Promise.resolve()
    }
    return api.misfiles(range)
      .then((review) => setMisfile(findMisfile(review, bookId)))
      .catch((caught) => {
        // Nothing said rather than a banner nobody can act on: an unanswered
        // review is not evidence the book is fine, and the error already has
        // somewhere to be shown.
        setMisfile(null)
        setError((caught as Error).message)
      })
  }, [bookId, draft.genre, setError])

  useEffect(() => {
    if (route !== 'review') {
      setMisfile(null)
      return
    }
    void loadMisfile()
  }, [route, loadMisfile])

  /*
   * `reloadShelfState`, `confirmMisfileMoved` and `takeMisfileBack` were here,
   * and they went together with the answers that called them (#409).
   *
   * The book's page used to write a location from a notice: "Moved it" meant
   * somebody had carried the book, and it was typed at whatever the person
   * happened to be looking at. The notice is a door now, and the write happens
   * where it always should have, on the screen that places a book, when they say
   * it fits. `takeMisfileBack` went the same way and is not lost either: the
   * library's list of books needing attention still offers "Undo the move" for
   * every move the app made and nobody acted on (#196), which is where the other
   * half of that pair has always lived.
   *
   * **The reason those three were one call is gone with them.** #197 was the
   * notice and the drawing under it being two reads of one set of shelves, so an
   * action that moved a book had to re-read both or leave the picture
   * contradicting the tap. Nothing on this page moves a book any more; leaving
   * for the shelving step and coming back reloads both from scratch.
   */

  return { placement, setPlacement, placementStale, refreshPlacement, misfile }
}
