/**
 * The page under a converted screen takes the design system's paper.
 *
 * See `body.wf-page` in `design/library.css`: the app paints `html, body` a cold
 * dark blue-grey, which otherwise shows either side of the 480 pixel column and
 * under an overscroll bounce. `HomeScreen` has done this inline since #303; this
 * is the same three lines with a name, so the carry screens do not each carry a
 * copy of a comment explaining somebody else's stylesheet.
 */

import { useEffect } from 'react'

export function usePaper(): void {
  useEffect(() => {
    document.body.classList.add('wf-page')
    return () => document.body.classList.remove('wf-page')
  }, [])
}
