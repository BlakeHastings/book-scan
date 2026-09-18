/**
 * The frame every screen wears: a top bar, a scrolling body, a tab bar.
 *
 * It does not add the `.wf` token scope itself: that is the page's job (the
 * gallery's own root or the app's screen wrapper), and adding a second one
 * here would nest it inside the gallery's chrome bar.
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
  /** Called with which tab was picked; the frame does not decide where it leads. */
  onTab?: (name: TabName) => void
  top: ReactElement
  /**
   * A dialog over the whole screen. The screen underneath stays fully drawn,
   * on purpose: hiding it behind a scrim would ask the person to remember
   * what they were just looking at.
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
