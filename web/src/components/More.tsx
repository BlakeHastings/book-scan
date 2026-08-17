/**
 * The bottom of a listing that has more of itself to come.
 *
 * Two things, and both are deliberate. The mark above the button is watched, so
 * reaching the end of what has loaded asks for the next page before somebody
 * gets there and the scroll simply continues. The button is what that is built
 * on rather than a fallback nobody sees: a page that only loads on a gesture the
 * browser reports is a page that never finishes on anything that does not report
 * it, and there is always something to press.
 *
 * It says the numbers, because "more" on its own is the one thing a person
 * cannot judge: sixty more of two hundred is a scroll and sixty more of three
 * thousand is a decision.
 *
 * ## Asking is an edge, not a state, and that is the whole of #364
 *
 * The first version of this rebuilt the observer on every render, asked
 * whenever the mark was in view, and relied on the arriving page pushing the
 * mark down out of view again to stop. That is a loop with no floor under it:
 * ask, draw the page, the mark is still in view, ask again. It ran to the end of
 * the catalogue in half a second without anybody scrolling, and the flicker
 * somebody sees at the bottom of the library is `loading` going true and false
 * once per lap of it.
 *
 * It only bit **one of the library's three drawings**, which is why it looked
 * like a mystery about views. Covers and the list grow by a page of height for
 * every page of books, so the mark leaves the screen and the next ask waits for
 * a real scroll. The boards do not: one area is one row of spines that scrolls
 * sideways, so sixty more books make an existing row longer rather than making
 * the page taller, and the mark never moves.
 *
 * So the observer is made once, kept for the life of this component, and left
 * connected. Asking happens on the arrival of the mark and nowhere else, which
 * is `reported` in `src/lib/reachingTheEnd.ts`: that rule is four lines of
 * arithmetic about two booleans, it is the whole of the fix, and it is written
 * where a test can replay a run of reports at it without a browser. A page that
 * does not push the mark away produces no arrival, therefore no fetch: the loop
 * has no step to take rather than a slower one. Somebody who wants the next
 * page after that presses the button, which is the control this was always
 * built on top of.
 *
 * That is also why `onMore` and `loading` are read through refs. They change
 * identity or value on every render, and putting them in the dependency list is
 * what made the observer new each time, which restarted the arrival and is the
 * loop itself.
 *
 * `shown` went with them. It was a number nothing drew, passed in only to make
 * the effect run again when a page landed, which is the thing that must not
 * happen.
 */

import { useEffect, useRef } from 'react'
import { Button } from '../design/Controls'
import { reported, UNREACHED, type Reach } from '../lib/reachingTheEnd'

export function More({
  total,
  loading,
  onMore,
}: {
  /** How many the query matches, which is the number the button says. */
  total: number
  loading: boolean
  onMore: () => void
}) {
  const mark = useRef<HTMLDivElement>(null)
  /** What the watcher last said, so an arrival can be told from a state. */
  const reach = useRef<Reach>(UNREACHED)
  /*
   * The two things the observer needs and must not be rebuilt for. `onMore` is
   * a fresh closure on every render of the listing that owns it, so an effect
   * that depended on it ran again on every render.
   */
  const ask = useRef(onMore)
  ask.current = onMore
  const busy = useRef(loading)
  busy.current = loading

  useEffect(() => {
    const node = mark.current
    // Not every browser this runs on has one, and a listing that will not load
    // its second page is worse than one that needs a press.
    if (!node || typeof IntersectionObserver === 'undefined') return

    const watch = new IntersectionObserver(
      (entries) => {
        const onScreen = entries[entries.length - 1]?.isIntersecting ?? false
        const answer = reported(reach.current, onScreen, busy.current)
        reach.current = answer.reach
        if (answer.fetch) ask.current()
      },
      // Far enough ahead that the page is usually there by the time somebody
      // scrolls to where it goes.
      { rootMargin: '600px' },
    )

    watch.observe(node)
    return () => watch.disconnect()
    // Once. The mark is the same element for as long as there is more to come,
    // and the observer's job is to report when it arrives at the edge of the
    // screen, which is not a question any render has a new answer to.
  }, [])

  return (
    <div className="wf-under">
      <div ref={mark} aria-hidden="true" />
      <Button tone="quiet" block onPress={onMore}>
        {loading ? 'Fetching more books' : `Show more of the ${total}`}
      </Button>
    </div>
  )
}
