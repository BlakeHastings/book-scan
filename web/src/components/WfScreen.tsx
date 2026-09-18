/**
 * `.wf` scopes the design system's tokens; a screen made of those components
 * must sit inside one. `HomePane` has its own copy of this rather than
 * sharing it: merging them would touch a screen somebody else is converting,
 * so the two stay separate until that settles.
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
