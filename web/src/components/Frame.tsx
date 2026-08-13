/**
 * The phone, for a screen drawn with the design system.
 *
 * `Phone` in `src/design` is the frame; this is the app's way of wearing one.
 * It carries the two things a real screen needs that a wireframe does not: the
 * token scope, and a tab bar wired to the route table rather than to a gallery.
 *
 * `.wf` is where every colour, size and radius in the design system is defined,
 * so a screen drawn with those components has to sit inside one. The app's own
 * stylesheet keeps `:root` and is untouched by it.
 *
 * The body class is the other half. `body.wf-page` paints the page the design
 * system's paper, which otherwise shows either side of the 480px column and
 * under an overscroll bounce. It goes on when a screen like this is on and comes
 * off when it is not, so an unconverted screen still looks like itself.
 */

import { useEffect, type ReactElement, type ReactNode } from 'react'
import { Phone } from '../design/Phone'
import type { TabName } from '../design/Chrome'
import { useNavigation, type Route } from '../app/navigation'

/**
 * Where each tab goes.
 *
 * Four places, and finding is not one of them: it is the one action in the
 * library's top right, because looking for a book is not somewhere you go, it is
 * something you do to what you are already looking at. The camera is `capture`
 * rather than `scan`, which is the other camera: `scan` finds a book you are
 * already holding and has its own door on the first screen.
 */
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
