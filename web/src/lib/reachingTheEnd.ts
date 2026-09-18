/**
 * Asking is an edge, not a state: the mark being on screen is not a reason to fetch, the mark
 * *arriving* on screen is. Fetching whenever the mark is on screen relies on the arriving page
 * pushing the mark back off it, which holds for the covers and the list but not for the boards,
 * where one area is a row of spines that scrolls sideways: more books lengthen the row rather
 * than move the mark, so the mark never leaves and a level check would fetch the whole catalogue
 * in a loop.
 */

/** What the last report said, which is all the memory this needs. */
export interface Reach {
  /** Whether the mark under the last book was on screen when last reported. */
  readonly onScreen: boolean
}

/** Nothing has been reported yet, so nothing has arrived yet either. */
export const UNREACHED: Reach = { onScreen: false }

export interface Reached {
  readonly reach: Reach
  /** Whether this report is the end of the listing arriving, and so a fetch. */
  readonly fetch: boolean
}

/**
 * `loading` suppresses the fetch and not the edge: the mark still counts as arrived, so the next
 * report of the same state does not look like a fresh arrival and re-fetch.
 */
export function reported(was: Reach, onScreen: boolean, loading: boolean): Reached {
  return {
    reach: { onScreen },
    fetch: onScreen && !was.onScreen && !loading,
  }
}
