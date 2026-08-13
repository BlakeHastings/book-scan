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
 */

import { useEffect, useRef } from 'react'
import { Button } from '../design/Controls'

export function More({
  shown,
  total,
  loading,
  onMore,
}: {
  shown: number
  total: number
  loading: boolean
  onMore: () => void
}) {
  const mark = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = mark.current
    // Not every browser this runs on has one, and a listing that will not load
    // its second page is worse than one that needs a press.
    if (!node || loading || typeof IntersectionObserver === 'undefined') return

    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        // Once. The next page arriving is what puts a new mark on the screen,
        // and an observer left connected asks for every page at once.
        watch.disconnect()
        onMore()
      },
      // Far enough ahead that the page is usually there by the time somebody
      // scrolls to where it goes.
      { rootMargin: '600px' },
    )

    watch.observe(node)
    return () => watch.disconnect()
    // `shown` is in here because a page arriving is what makes the mark worth
    // watching again: same element, further down a longer page.
  }, [loading, shown, onMore])

  return (
    <div className="wf-under">
      <div ref={mark} aria-hidden="true" />
      <Button tone="quiet" block onPress={onMore}>
        {loading ? 'Fetching more books' : `Show more of the ${total}`}
      </Button>
    </div>
  )
}
