/**
 * `.wf` scopes the design system's tokens, same as `RoomFrame`. `body.wf-page`
 * additionally paints the page the design system's paper, which otherwise
 * shows on either side of the 480px column and under overscroll bounce; it
 * toggles with mount so an unconverted screen still looks like itself.
 */

import { useEffect, type ReactElement, type ReactNode } from 'react'
import { Phone } from '../design/Phone'
import type { TabName } from '../design/Chrome'
import { useNavigation, type Route } from '../app/navigation'

/** The `scan` tab maps to the `capture` route (photographing a new book); the other camera, for a book already in hand, is reached from a corner rather than a tab. */
const TAB_ROUTES: Record<TabName, Route> = {
  home: 'home',
  library: 'library',
  scan: 'capture',
  queue: 'queue',
}

export function Frame({
  tab,
  top,
  over,
  children,
}: {
  tab: TabName
  top: ReactElement
  /** A dialog over the whole screen, where a screen has one. */
  over?: ReactElement
  children?: ReactNode
}) {
  const { setRoute } = useNavigation()

  useEffect(() => {
    document.body.classList.add('wf-page')
    return () => document.body.classList.remove('wf-page')
  }, [])

  return (
    <div className="wf">
      <Phone tab={tab} onTab={(name) => setRoute(TAB_ROUTES[name])} top={top} over={over}>
        {children}
      </Phone>
    </div>
  )
}
