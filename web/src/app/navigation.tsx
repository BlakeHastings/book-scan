/**
 * Which screen is on, and the places a screen has to be put back to.
 *
 * ## The route is in memory and not in the URL, on purpose
 *
 * Nothing here reads or writes `window.location`. That is a decision rather
 * than an omission, and the questions a URL would create are the reason:
 *
 * - **Refresh mid-scan.** The screens that matter here are not addressable.
 *   Review is "the book in your hands, with what you have typed into it and a
 *   claim held on its capture"; the camera is "a live media stream and three
 *   photographs that are not on the server yet". A URL that reopened either
 *   would either lie about what is on screen or throw the work away.
 * - **The back button.** Leaving a book is not free: it releases the capture
 *   lock and hands back what was typed (`clearBookInHand`). A history entry
 *   per screen would make the phone's back gesture do that silently, and the
 *   gesture is already spoken for, by `putDownOnPageHide`.
 * - **A shared link.** There is nothing here worth linking to that a person
 *   could not reach in two taps, and every candidate is somebody else's
 *   half-filled form.
 *
 * The hash is also not free to take: `src/design/gallery/route.ts` owns it,
 * and an app that started reading hashes would have to agree with it.
 *
 * So the address bar stays as it is. If routing should become URL-driven, it
 * is a change with those three answers in it, and this is not that change.
 */

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { ShelfRange } from '../../shared/shelving'
import type { LibraryReturnAnchor } from '../components/ShelfView'
import type { QueueReturnAnchor } from '../components/QueuePane'

/**
 * The screens, one name each.
 *
 * `scan` used to be a boolean beside the mode rather than a mode of its own,
 * drawn over whatever was underneath. It never was over anything: every way
 * into it left the mode on `home` and every way out set it there, so it is
 * written down here as what it always was, which is a screen.
 */
export type Route =
  | 'home' | 'capture' | 'review' | 'shelve' | 'library' | 'queue' | 'arrange' | 'scan'
  /*
   * Describing the furniture (#313). Six screens rather than one, because they
   * are six places somebody can be: the room, a piece, an area, cutting an
   * area in two, what belongs in one, and how one is ordered. Which piece and
   * which area they are about is `app/arranging.tsx`, and it holds ids and
   * never a label.
   */
  | 'furniture' | 'fixture' | 'area' | 'addarea' | 'belongs' | 'sorting'
  /*
   * Why one book is here (#323). Not part of the six: two screen groups reach
   * it, the furniture and the book page, and it goes back to whichever one it
   * was opened from rather than to a fixed place.
   */
  | 'claimed'
  /*
   * Putting things right (#314): the whole of the work, one trip read at the
   * piece of furniture, one book placed, the trip finished, and what changed
   * while somebody was away. Five screens and one job, which is why the armful
   * they pass between them lives in `app/armful.tsx` rather than on any of them.
   */
  | 'carry' | 'trip' | 'carrying' | 'carried' | 'carrystale'
  /*
   * The library's own screens (#315). `book` is a book's own page, which is
   * about the book; `review` is the form its record is corrected on, and the two
   * are one journey rather than two doors to one room. `find` and `tags` are
   * where the library is narrowed, and both wear the library tab because looking
   * for a book is not somewhere you go.
   *
   * `shelves` is what the library screen used to be, kept reachable while the
   * carrying and the furniture screens are built beside it. See
   * `screens/ShelvesScreen.tsx`.
   */
  | 'book' | 'find' | 'tags' | 'shelves'

export interface Navigation {
  readonly route: Route
  readonly setRoute: Dispatch<SetStateAction<Route>>
  /**
   * Where in the queue listing to land on the way back, since the book being
   * shelved leaves the queue behind and the row it sat in goes with it. The
   * queue is the origin itself; this is only the position within it.
   */
  readonly queueReturn: QueueReturnAnchor | null
  readonly setQueueReturn: Dispatch<SetStateAction<QueueReturnAnchor | null>>
  /**
   * Where the library was when a book was opened from it. Rows are long and
   * the page is a stack of them, so coming back to the top of the first
   * bookcase means finding your place again every time.
   */
  readonly libraryReturn: LibraryReturnAnchor | null
  readonly setLibraryReturn: Dispatch<SetStateAction<LibraryReturnAnchor | null>>
  /**
   * Which run the arrange screen is about. Kept here for the reason the library
   * anchor is: ShelfView is unmounted the moment the screen changes, so the tab
   * it was on has to be carried out of it rather than asked for afterwards.
   */
  readonly arranging: ShelfRange
  readonly setArranging: Dispatch<SetStateAction<ShelfRange>>
  /** Open the library on a particular run, from the top. */
  readonly openLibraryOn: (range: ShelfRange) => void
  /**
   * Change what belongs somewhere: open the retarget-plan-apply screen.
   *
   * **There is one of these and this is the way to it** (#323). It is #244's
   * screen, reached from the library and now from the rule itself, and the way
   * back is wherever it was opened from, because "back" after cancelling a
   * change has to be the screen that offered it.
   */
  readonly openArranging: (range: ShelfRange) => void
  /** Back to the screen that offered the change, whichever one it was. */
  readonly leaveArranging: () => void
  /** Which screen that is, so the way back can be named rather than "Back". */
  readonly arrangeFrom: Route
  /** Which book the claim screen is about, and where it goes back to. */
  readonly claiming: number | null
  readonly openClaim: (bookId: number) => void
  /** Back to the screen the claim was opened from, whichever it was. */
  readonly closeClaim: () => void
}

const Context = createContext<Navigation | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>('home')
  const [queueReturn, setQueueReturn] = useState<QueueReturnAnchor | null>(null)
  const [libraryReturn, setLibraryReturn] = useState<LibraryReturnAnchor | null>(null)
  const [arranging, setArranging] = useState<ShelfRange>('fiction')
  /*
   * Where two screens that several places reach go back to. Kept as a route
   * rather than as a flag per caller: adding a third way in should be a call
   * rather than another branch in whichever screen draws the back arrow.
   */
  const [arrangeBack, setArrangeBack] = useState<Route>('shelves')
  const [claiming, setClaiming] = useState<number | null>(null)
  const [claimBack, setClaimBack] = useState<Route>('review')

  /**
   * Open the shelves on a particular run, from the top.
   *
   * The same anchor a book uses to come back, with no book in it: the screen
   * opens on the tab it is given, finds nothing to scroll to, and reports the
   * anchor consumed. Which is exactly what leaving the arrange screen needs,
   * and is why it does not get a second mechanism.
   *
   * **It lands on `shelves` rather than `library` since #315.** `ShelfView` is
   * the only thing that reads this anchor and #315 moved it there; the library
   * tab is the browsing screen now and has nothing to scroll to.
   */
  const openLibraryOn = (range: ShelfRange) => {
    setLibraryReturn({ range, bookId: 0, scrollY: 0 })
    setRoute('shelves')
  }

  const openArranging = (range: ShelfRange) => {
    setArranging(range)
    setArrangeBack(route)
    setRoute('arrange')
  }

  /*
   * The shelves are not just a route: they are a route and the place in them, so
   * leaving lands on the stretch of books this was about rather than at the top
   * of the other one. Every other way in is a plain route.
   */
  const leaveArranging = () => {
    if (arrangeBack === 'shelves') openLibraryOn(arranging)
    else setRoute(arrangeBack)
  }

  const openClaim = (bookId: number) => {
    setClaiming(bookId)
    setClaimBack(route)
    setRoute('claimed')
  }

  return (
    <Context.Provider
      value={{
        route, setRoute,
        queueReturn, setQueueReturn,
        libraryReturn, setLibraryReturn,
        arranging, setArranging,
        openLibraryOn,
        openArranging,
        leaveArranging,
        arrangeFrom: arrangeBack,
        claiming,
        openClaim,
        closeClaim: () => setRoute(claimBack),
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useNavigation(): Navigation {
  const found = useContext(Context)
  if (!found) throw new Error('useNavigation was called outside NavigationProvider')
  return found
}
