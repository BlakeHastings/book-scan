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
 * A table rather than a chain of conditionals, and one table rather than
 * one per exit: every origin appears here, so a new one cannot be added
 * without saying where it goes back to.
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
   * Read by the one screen that finishes with a book before it stops
   * talking about it: shelving lets go of the book the moment it reaches a
   * shelf, so by the time somebody presses "Next book" there is nothing
   * left to read the origin off. That screen takes this while the book is
   * still in hand and goes there itself, off the same table.
   */
  readonly landing: Route
}

export function useLeaving(): Leaving {
  const { setRoute, setQueueReturn } = useNavigation()
  const { origin, bookId, clearBookInHand } = useBookInHand()

  /*
   * Where finishing with this book leads, worked out while it is still in
   * hand: putting a book down is what forgets where it came from.
   */
  const landing = RETURN_TO[origin]

  /**
   * Put the book down and go back to wherever it was picked up. The one
   * way out, shared by finishing shelving, abandoning it, and leaving a
   * catalogued book alone.
   *
   * `queueReturn` survives on purpose: `QueuePane` uses it once to land
   * near the book just handled, then reports it consumed.
   */
  const returnToOrigin = () => {
    clearBookInHand()
    setRoute(landing)
  }

  /**
   * Go somewhere else from the header: the Camera, Queue and Library tabs,
   * the "Book scan" title, and the "Back to camera" button in review.
   *
   * One function for all of them, so a fourth destination cannot be added
   * without the way out coming with it.
   *
   * Whether the book survives the trip is `bookStillInHand`'s call; see
   * `lib/cameraReturn.ts`.
   */
  const leaveFor = (next: Route) => {
    if (!bookStillInHand(origin === 'queue', bookId)) {
      clearBookInHand()
      // Where in the queue listing the book sat is only useful to a trip
      // that ends in the queue.
      if (next !== 'queue') setQueueReturn(null)
    }
    setRoute(next)
  }

  return { returnToOrigin, leaveFor, landing }
}
