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
import { canTakeBack, findMisfile, recordMoved, takeMoveBack } from '../lib/misfile'
import { rangeOfSlug } from '../../domain/tagging/genre'
import type { Route } from './navigation'

export interface ShelfState {
  readonly placement: PlacementResponse | null
  readonly setPlacement: Dispatch<SetStateAction<PlacementResponse | null>>
  readonly placementStale: boolean
  /** After books have physically moved, so the drawn shelf matches the shelf. */
  readonly refreshPlacement: () => Promise<void>
  /** Re-read everything on this page that describes where the book sits. */
  readonly reloadShelfState: () => Promise<void>
  readonly misfile: Misfile | null
  readonly misfileTakeable: boolean
  readonly misfileMoving: boolean
  readonly confirmMisfileMoved: () => Promise<void>
  readonly takeMisfileBack: () => Promise<void>
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
      setMisfileTakeable(false)
      return Promise.resolve()
    }
    return api.misfiles(range)
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
  }, [bookId, draft.genre, setError])

  useEffect(() => {
    if (route !== 'review') {
      setMisfile(null)
      setMisfileTakeable(false)
      return
    }
    void loadMisfile()
  }, [route, loadMisfile])

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
    const range = rangeOfSlug(draft.genre)
    if (!misfile || range === null) return
    setMisfileMoving(true)
    setError('')
    try {
      await takeMoveBack(range, misfile.book.id)
      await reloadShelfState()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setMisfileMoving(false)
    }
  }

  return {
    placement, setPlacement, placementStale, refreshPlacement, reloadShelfState,
    misfile, misfileTakeable, misfileMoving, confirmMisfileMoved, takeMisfileBack,
  }
}
