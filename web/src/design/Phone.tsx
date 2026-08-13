/**
 * The frame every screen wears: a top bar, a scrolling body, a tab bar.
 *
 * This lived inside `gallery/screens.tsx` while the gallery was the only thing
 * drawing a screen. It is here because it is no longer: `src/components` draws
 * the first screen with it too, and a frame written twice is two frames that
 * agree until one of them is edited.
 *
 * It does not carry `.wf` itself. The token scope is the page, and the page is
 * the gallery's own root or the app's screen wrapper; a `Phone` that painted
 * one would put a second one inside the gallery's chrome bar.
 */

import type { ReactElement, ReactNode } from 'react'
import { TabBar, type TabName } from './Chrome'

export function Phone({
  children,
  tab,
  onTab,
  top,
  over,
}: {
  children: ReactNode
  tab: TabName
  /** Where each tab goes. The frame knows the four places, not the journey. */
  onTab?: (name: TabName) => void
  top: ReactElement
  /**
   * A dialog over the whole screen, where a screen has one. The screen under
   * it is drawn in full and on purpose: what somebody is being asked about is
   * the thing they were just looking at, and a scrim that hid it would be
   * asking them to remember it.
   */
  over?: ReactElement
}) {
  return (
    <div className={`wf-screen${over ? ' wf-screen--asked' : ''}`}>
      {top}
      <div className="wf-screen__body">{children}</div>
      <TabBar on={tab} onPick={onTab} />
      {over}
    </div>
  )
}
