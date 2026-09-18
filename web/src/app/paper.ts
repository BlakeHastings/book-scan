/** See `body.wf-page` in `design/library.css`: without it the app paints `html, body` a cold dark blue-grey either side of the 480 pixel column and under an overscroll bounce. */

import { useEffect } from 'react'

export function usePaper(): void {
  useEffect(() => {
    document.body.classList.add('wf-page')
    return () => document.body.classList.remove('wf-page')
  }, [])
}
