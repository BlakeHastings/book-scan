/**
 * When the end of a paged listing arriving on screen is worth another page.
 *
 * The library and the find screen both watch a mark under the last book and
 * fetch the next page when it comes into view. The decision that watching feeds
 * is four lines of arithmetic about two booleans, and it is here rather than
 * inside the effect for the reason `areaRuns` is in its own file: a rule a test
 * can only reach through a browser is a rule that gets tested by looking at it.
 *
 * ## The rule, and the defect it is written against
 *
 * **Asking is an edge, not a state.** The mark being on screen is not a reason
 * to fetch; the mark *arriving* on screen is. The difference is the whole of
 * #364.
 *
 * What it replaced asked whenever the mark was on screen and relied on the page
 * that arrived pushing the mark back off it. That holds for the covers and the
 * list, which grow by a page of height for every page of books. It does not
 * hold for the boards, where one area is one row of spines that scrolls
 * sideways: sixty more books lengthen a row rather than lower the mark, so the
 * mark never left, the answer never changed, and the asking fed itself down the
 * whole catalogue in half a second. The flicker somebody saw at the bottom of
 * the library was `loading` going true and false once per lap.
 *
 * Under this rule that loop has no step to take rather than a slower one. A
 * page that does not move the mark reports nothing new, so nothing asks, and
 * the button underneath is what somebody presses to see more. Infinite scroll
 * is untouched where the drawing really does grow: the mark goes off screen
 * with the page and comes back when the scroll catches up, which is an edge.
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
 * Fold one report from the watcher into the reach, and say whether to fetch.
 *
 * `loading` suppresses the fetch and not the edge. A page already on its way is
 * the answer to this arrival, so asking again would be asking twice for it; but
 * the mark did arrive, and pretending otherwise would leave the next report of
 * the same state looking like a fresh arrival.
 */
export function reported(was: Reach, onScreen: boolean, loading: boolean): Reached {
  return {
    reach: { onScreen },
    fetch: onScreen && !was.onScreen && !loading,
  }
}
