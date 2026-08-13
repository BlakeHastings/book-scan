/**
 * A screen drawn with the design system, inside the scope its tokens live in.
 *
 * `.wf` is where every colour, size and radius in `src/design` is defined, so a
 * screen made of those components has to sit inside one. The app's own
 * stylesheet keeps `:root` and is untouched by it.
 *
 * `HomePane` has its own copy of this, from before there was a second converted
 * screen to share one with. Folding that one into this is a change to a screen
 * somebody else is converting, so it is left where it is and this is what the
 * carry screens use; the two should become one when the conversion settles.
 */

import type { ReactElement, ReactNode } from 'react'
import { type TabName } from '../design/Chrome'
import { Phone } from '../design/Phone'

export function WfScreen({
  tab, top, tabs, over, children,
}: {
  tab: TabName
  top: ReactElement
  tabs: Record<TabName, () => void>
  over?: ReactElement
  children?: ReactNode
}) {
  return (
    <div className="wf">
      <Phone tab={tab} onTab={(name) => tabs[name]()} top={top} over={over}>
        {children}
      </Phone>
    </div>
  )
}
