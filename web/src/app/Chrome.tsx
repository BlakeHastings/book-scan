/**
 * The frame the scrolling pages sit in: the header, the tabs and the error
 * line.
 *
 * The two full-screen cameras are outside it, which is why the route table
 * says per screen whether the frame is drawn rather than this deciding.
 */

import type { ReactNode } from 'react'
import { useSummary } from './summary'
import { useErrorBanner } from './errorBanner'
import { useLeaving } from './leaving'
import { useNavigation } from './navigation'

export function Chrome({ children }: { children: ReactNode }) {
  const { route } = useNavigation()
  const { counts } = useSummary()
  const { error, setError } = useErrorBanner()
  const { leaveFor } = useLeaving()

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <button className="topbar__home" onClick={() => leaveFor('home')}>
            Book scan
          </button>
        </h1>
        {/* No longer hidden on the first screen: the first screen no longer
            comes through here at all. It wears the design system's own top bar
            and tab bar and is drawn without this frame (#303). */}
        <nav>
          <button className="tab" onClick={() => leaveFor('capture')}>Camera</button>
          <button
            className={route === 'queue' ? 'tab tab--on' : 'tab'}
            onClick={() => leaveFor('queue')}
          >
            Queue
          </button>
          <button
            className={route === 'library' ? 'tab tab--on' : 'tab'}
            onClick={() => leaveFor('library')}
          >
            Library
          </button>
        </nav>
        {counts && (
          <span className="counts">
            {counts.total} books · {counts.fiction} fiction · {counts.nonfiction} non-fiction
          </span>
        )}
      </header>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {children}
    </div>
  )
}
