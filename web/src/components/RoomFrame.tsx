/**
 * The frame every arranging screen wears, and the two things all six of them
 * have to draw the same way.
 *
 * ## The token scope
 *
 * `.wf` is where every colour, size and radius in the design system is
 * defined, so a screen drawn with these components has to sit inside one. Six
 * screens each opening their own would be six chances to forget, and the one
 * that forgot would look like the app rather than like the redesign.
 *
 * ## Trouble
 *
 * These screens are outside the app's chrome, which is where the error line
 * lives, so a refusal has to be drawn by the screen that caused it. It is a
 * quiet card carrying the server's own sentence, because the server's sentence
 * is the useful one: "Its 63 books move to other furniture first" says what to
 * do next, and "409" does not.
 */

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { Card } from '../design/Card'
import type { TabName } from '../design/Chrome'
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
 * What went wrong, in the words whatever refused it used.
 *
 * It scrolls itself into view, and that is not a flourish. The button that gets
 * refused most is the one at the very bottom of a piece's screen, and its
 * refusal is the sentence that says what to do instead; drawn at the top of a
 * page somebody is standing at the foot of, it is a button that did nothing.
 */
export function Trouble({ said }: { said: string }) {
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (said) card.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [said])

  if (!said) return null
  return (
    <div ref={card}>
      <Card weight="quiet" kind="That did not work" title={said} />
    </div>
  )
}
