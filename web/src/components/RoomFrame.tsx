/** `.wf` scopes every colour, size and radius the design system defines; a screen drawn with these components must sit inside one or the tokens will not apply. */

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { Card } from '../design/Card'
import type { TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Phone } from '../design/Phone'

export function RoomFrame({
  top, tabs, over, children,
}: {
  top: ReactElement
  tabs: Record<TabName, () => void>
  /** A dialog over the whole screen, where a screen has one. */
  over?: ReactElement
  children?: ReactNode
}) {
  return (
    <div className="wf">
      <Phone tab="library" onTab={(name) => tabs[name]()} top={top} over={over}>
        {children}
      </Phone>
    </div>
  )
}

/**
 * These screens sit outside the app's chrome, where the shared error line
 * lives, so each draws its own refusal. Scrolls itself into view: the button
 * that gets refused most is at the bottom of a long screen, so without this
 * the refusal would render off-screen at the top.
 */
export function Trouble({ said, onDismiss }: {
  said: string
  /** Most refusals clear themselves when the thing is tried again, so most callers pass nothing here; this is only for refusals that arrive after whatever asked has already closed, such as a lookup that failed after the person navigated away. */
  onDismiss?: () => void
}) {
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (said) card.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [said])

  if (!said) return null
  return (
    <div ref={card}>
      <Card
        weight="quiet"
        kind="That did not work"
        title={said}
        foot={onDismiss && (
          <Button tone="quiet" block onPress={onDismiss}>
            Dismiss
          </Button>
        )}
      />
    </div>
  )
}
