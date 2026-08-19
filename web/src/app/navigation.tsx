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
import type { QueueReturnAnchor, Which } from '../components/QueuePane'

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
   * Describing the furniture (#313). **Three screens, where there were six**
   * (#381): the room, a piece, and an area. The three that went were not places
   * somebody wanted to be. Cutting an area in two asked a question the owner
   * did not want asked, so adding an area is a press on the room; what belongs
   * in a place and how it is ordered explained themselves on screens of their
   * own, and are now the two widgets on the page of the place they are about.
   *
   * Which piece and which area they are about is `app/arranging.tsx`, and it
   * holds ids and never a label.
   */
  | 'furniture' | 'fixture' | 'area'
  /*
   * What the corner opens onto (#350). Not one of the furniture six: it is
   * about the collection rather than about a piece of it, and it is reached
   * from the same menu the furniture is reached from.
   */
  | 'settings'
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
   * The books no rule claims (#341). Beside the carrying screens rather than
   * among them: it is the other half of putting things right, and it is the one
   * kind of work no count on the first screen can hold, because such a book is
   * in no range, on no carry list and in no review. Reached from the first
   * screen's third door and from nowhere else.
   */
  | 'unclaimed'
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
   * Which books the queue opens on, or null for the whole of it (#436).
   *
   * Kept here for the reason the anchor above is kept here: the screen that
   * says which books somebody wants is unmounted before the queue mounts, so
   * the answer has to be carried rather than asked for. Consumed on the way in
   * and cleared, so the tab bar still opens the whole queue.
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
  /**
   * Open one of the two screens the corner leads to, from wherever you are.
   *
   * **The corner is on more than one screen, which is the whole reason this
   * exists** (#350). The furniture screen's back arrow used to go to the
   * library and nowhere else, which was already a wrinkle #333 named: walking
   * in from the menu and straight back out landed you on your books rather
   * than where you started. Now the menu can be opened from the first screen
   * as well, so "back to the library" would be wrong more often than it is
   * right, and the answer is the one `openArranging` already uses: remember
   * the screen that offered it.
   */
  readonly openRoom: (screen: 'furniture' | 'settings') => void
  /** Back to the screen the corner was opened from, whichever one it was. */
  readonly leaveRoom: () => void
  /**
   * Open the scanner: the camera that reads a book you are already holding.
   *
   * **Every way in goes through this and closing it comes back here** (#350).
   * It used to be `setRoute('scan')` from five screens and one `setRoute('home')`
   * to leave, so giving up on the scanner put you on the first screen whichever
   * screen you had opened it from. That was survivable while its only real door
   * was the first screen's corner; the profile icon has that corner now and the
   * scanner's door moved to the screen about finding a book, where being
   * dropped two screens away from what you were searching is somebody's search
   * thrown out.
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
   * Where the corner was pressed. The library is the fallback because that is
   * where the furniture was reached from before there was a corner, and
   * because a screen that has never been opened from anywhere still has to
   * have a way out.
   */
  const [roomBack, setRoomBack] = useState<Route>('library')
  /* Where the scanner was opened from. The first screen is the fallback for the
     same reason the library is above: a screen has to have a way out even if
     nothing ever recorded a way in. */
  const [scanBack, setScanBack] = useState<Route>('home')

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

  /*
   * Deliberately not recorded when the corner is opened from one of these two
   * screens itself. Nothing opens the corner from inside the furniture today,
   * and if something ever does, a back arrow that returns you to the screen you
   * are already on is a button that does nothing.
   */
  const openRoom = (screen: 'furniture' | 'settings') => {
    if (route !== 'furniture' && route !== 'settings') setRoomBack(route)
    setRoute(screen)
  }

  const openScanner = () => {
    /* Not from inside itself, and it can be: finishing with a scanned book
       lands back in the scanner, and a way out that returned you to the
       scanner would be a button that does nothing. */
    if (route !== 'scan') setScanBack(route)
    setRoute('scan')
  }

  return (
    <Context.Provider
      value={{
        route, setRoute,
        queueReturn, setQueueReturn,
        queueShowing,
        /* Both in one call, because the two apart is how "31 stuck" opened the
           queue on "All 39": a caller that sets the route and forgets the
           filter is a count that does not keep its promise. */
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
