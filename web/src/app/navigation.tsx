/**
 * Which screen is on, and the places a screen has to be put back to.
 *
 * The route is in memory and not in the URL, on purpose: nothing here reads or
 * writes `window.location`. The screens that matter are not addressable, since
 * review is the book in your hands with what you have typed into it and a claim
 * held on its capture, and the camera is a live media stream and three
 * photographs that are not on the server yet. A history entry per screen would
 * also make the phone's back gesture release a capture lock silently, and that
 * gesture is already spoken for by `putDownOnPageHide`.
 *
 * The hash is not free to take either: `src/design/gallery/route.ts` owns it.
 */

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { ShelfRange } from '../../shared/shelving'
import type { LibraryReturnAnchor } from '../components/ShelfView'
import type { QueueReturnAnchor, Which } from '../components/QueuePane'

/** The screens, one name each. */
export type Route =
  | 'home' | 'capture' | 'review' | 'shelve' | 'library' | 'queue' | 'arrange' | 'scan'
  /*
   * Describing the furniture: the room, a piece, and an area. Which piece and
   * which area they are about is `app/arranging.tsx`, which holds ids and never a
   * label.
   */
  | 'furniture' | 'fixture' | 'area'
  | 'settings'
  /*
   * Why one book is here. Two screen groups reach it, the furniture and the book
   * page, and it goes back to whichever one it was opened from rather than to a
   * fixed place.
   */
  | 'claimed'
  /*
   * Putting things right: the whole of the work, one trip read at the piece of
   * furniture, one book placed, the trip finished, and what changed while somebody
   * was away. Five screens and one job, which is why the armful they pass between
   * them lives in `app/armful.tsx` rather than on any of them.
   */
  | 'carry' | 'trip' | 'carrying' | 'carried' | 'carrystale'
  /*
   * The books no rule claims. Reached from the first screen's third door and from
   * nowhere else.
   */
  | 'unclaimed'
  /*
   * The library's own screens. `book` is a book's own page and `review` is the
   * form its record is corrected on, and the two are one journey rather than two
   * doors to one room. `find` and `tags` are where the library is narrowed.
   * `shelves` is what the library screen used to be, kept reachable: see
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
   * Which books the queue opens on, or null for the whole of it. Kept here for the
   * reason the anchor above is: the screen that says which books somebody wants is
   * unmounted before the queue mounts, so the answer has to be carried rather than
   * asked for. Consumed on the way in and cleared, so the tab bar still opens the
   * whole queue.
   */
  readonly queueShowing: Which | null
  /** Open the queue on the books a count was about. */
  readonly openQueueOn: (showing: Which) => void
  readonly clearQueueShowing: () => void
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
   * Change what belongs somewhere: open the retarget-plan-apply screen. There is
   * one of these and this is the way to it, and the way back is wherever it was
   * opened from, because "back" after cancelling a change has to be the screen
   * that offered it.
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
  /**
   * Open one of the two screens the corner leads to, from wherever you are. The
   * corner is on more than one screen, which is the whole reason this exists: a
   * fixed "back to the library" would be wrong more often than it is right, so
   * the answer is the one `openArranging` uses, which is to remember the screen
   * that offered it.
   */
  readonly openRoom: (screen: 'furniture' | 'settings') => void
  /** Back to the screen the corner was opened from, whichever one it was. */
  readonly leaveRoom: () => void
  /**
   * Open the scanner: the camera that reads a book you are already holding. Every
   * way in goes through this and closing it comes back here, so giving up on the
   * scanner does not drop somebody two screens away from what they were doing.
   */
  readonly openScanner: () => void
  /** Back to the screen the scanner was opened from. */
  readonly leaveScanner: () => void
}

const Context = createContext<Navigation | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>('home')
  const [queueReturn, setQueueReturn] = useState<QueueReturnAnchor | null>(null)
  const [queueShowing, setQueueShowing] = useState<Which | null>(null)
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
  /*
   * Where the corner was pressed. The library is the fallback, because a screen
   * that has never been opened from anywhere still has to have a way out.
   */
  const [roomBack, setRoomBack] = useState<Route>('library')
  /* Where the scanner was opened from. The first screen is the fallback for the
     same reason the library is above. */
  const [scanBack, setScanBack] = useState<Route>('home')

  /**
   * Open the shelves on a particular run, from the top. The same anchor a book
   * uses to come back, with no book in it: the screen opens on the tab it is
   * given, finds nothing to scroll to, and reports the anchor consumed.
   *
   * It lands on `shelves` rather than `library`, because `ShelfView` is the only
   * thing that reads this anchor; the library tab is the browsing screen and has
   * nothing to scroll to.
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

  /*
   * Deliberately not recorded when the corner is opened from one of these two
   * screens itself: a back arrow that returns you to the screen you are already
   * on is a button that does nothing.
   */
  const openRoom = (screen: 'furniture' | 'settings') => {
    if (route !== 'furniture' && route !== 'settings') setRoomBack(route)
    setRoute(screen)
  }

  const openScanner = () => {
    /* Not from inside itself, and it can be: finishing with a scanned book lands
       back in the scanner, and a way out that returned you there would be a
       button that does nothing. */
    if (route !== 'scan') setScanBack(route)
    setRoute('scan')
  }

  return (
    <Context.Provider
      value={{
        route, setRoute,
        queueReturn, setQueueReturn,
        queueShowing,
        /* Both in one call: a caller that sets the route and forgets the filter
           is a count that does not keep its promise. */
        openQueueOn: (showing: Which) => { setQueueShowing(showing); setRoute('queue') },
        clearQueueShowing: () => setQueueShowing(null),
        libraryReturn, setLibraryReturn,
        arranging, setArranging,
        openLibraryOn,
        openArranging,
        leaveArranging,
        arrangeFrom: arrangeBack,
        claiming,
        openClaim,
        closeClaim: () => setRoute(claimBack),
        openRoom,
        leaveRoom: () => setRoute(roomBack),
        openScanner,
        leaveScanner: () => setRoute(scanBack),
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
