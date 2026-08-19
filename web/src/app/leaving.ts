/**
 * The two ways off a screen that owe somebody the screen they came from.
 *
 * Both compose the book in hand with the route, which is why they are a hook
 * over both contexts rather than a method on either. Neither is allowed to
 * grow a third copy: the whole point of the table below, and of `leaveFor`
 * being one function, is that a new destination cannot be added without
 * saying what happens to the book.
 */

import { bookStillInHand } from '../lib/cameraReturn'
import { useBookInHand, type Origin } from './bookInHand'
import { useNavigation, type Route } from './navigation'

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
export const RETURN_TO: Record<Origin, Route> = {
  // Straight back to the viewfinder, so a pile of books is worked through
  // without a detour past the home screen.
  capture: 'capture',
  queue: 'queue',
  library: 'library',
  move: 'library',
  scan: 'scan',
}

export interface Leaving {
  /** Put the book down and go back to wherever it was picked up. */
  readonly returnToOrigin: () => void
  /** Go somewhere else from the header, taking the book down on the way. */
  readonly leaveFor: (next: Route) => void
  /**
   * Where finishing with the book on screen leads, which is the route
   * `returnToOrigin` is about to take.
   *
   * Read by the one screen that finishes with a book before it stops talking
   * about it. Shelving lets go of the book the moment it reaches a shelf
   * (#431), so by the time somebody presses "Next book" the origin has been
   * put down with everything else and there is nothing left to read it off.
   * That screen takes this while the book is still in hand and goes there
   * itself, off the same table, so there is still no second answer to where
   * finishing a book leads.
   */
  readonly landing: Route
}

export function useLeaving(): Leaving {
  const { setRoute, setQueueReturn } = useNavigation()
  const { origin, bookId, clearBookInHand } = useBookInHand()

  /*
   * Where finishing with this book leads, worked out while it is still in hand.
   *
   * Putting a book down is what forgets where it came from, so this has always
   * had to be read first. It is read at render now rather than inside the
   * function, which is the same "first" and one a caller can have too.
   */
  const landing = RETURN_TO[origin]

  /**
   * Put the book down and go back to wherever it was picked up.
   *
   * The one way out, shared by finishing shelving, by abandoning it, and by
   * leaving a catalogued book alone: they are all "done with this book"
   * moments, and they all owe the person the screen they started on. There
   * used to be two of these disagreeing about which screen that was.
   *
   * queueReturn survives on purpose; QueuePane uses it once to land near the
   * book just handled, then reports it consumed.
   */
  const returnToOrigin = () => {
    clearBookInHand()
    setRoute(landing)
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
  const leaveFor = (next: Route) => {
    if (!bookStillInHand(origin === 'queue', bookId)) {
      clearBookInHand()
      // Where in the queue listing the book sat, which is only any use to a
      // trip that ends in the queue. Going there by the tab lands near the
      // book just put down, the same as finishing with it does.
      if (next !== 'queue') setQueueReturn(null)
    }
    setRoute(next)
  }

  return { returnToOrigin, leaveFor, landing }
}
