/**
 * The mark above the button is watched, so the next page loads before
 * somebody scrolls to the bottom; the button is the fallback for a browser
 * that never reports that gesture, so there is always something to press.
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
  // Read through refs rather than effect dependencies: both change identity
  // or value every render, and either one in the dependency list would
  // rebuild the observer on every render.
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
    // Created once and left connected: it must react to the mark's arrival
    // at the edge of the screen, not to it merely being on screen. A listing
    // that does not grow taller when a page lands (the boards, which scroll
    // sideways) never pushes the mark away, so an observer rebuilt on every
    // render would re-fire on the same arrival and loop forever. See
    // `reported` in `src/lib/reachingTheEnd.ts` for the edge-detection rule.
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
