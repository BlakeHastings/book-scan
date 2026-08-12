/**
 * The frame of a screen: what is above the content and what is below it.
 *
 * The top bar is one line of book face and, where the screen is somewhere you
 * arrived at rather than somewhere you live, a back target the full 44px
 * wide. The tab bar carries a word under every icon, always: an icon on its
 * own is a guess the reader makes on every visit, and five guesses is a menu
 * nobody trusts.
 */

import type { ReactNode } from 'react'
import { IconBack, IconCamera, IconFind, IconHome, IconQueue, IconShelves } from './Icons'

export function TopBar({
  title,
  sub,
  onBack,
  action,
}: {
  title: string
  /** The second line, where the screen needs one. Counts, or where you are. */
  sub?: string
  onBack?: () => void
  /** One word, top right. Never two, and never an icon on its own. */
  action?: { word: string; onPress?: () => void }
}) {
  return (
    <header className={`wf-top${onBack ? '' : ' wf-top--plain'}`}>
      {onBack && (
        <button type="button" className="wf-top__back" onClick={onBack} aria-label="Back">
          <IconBack />
        </button>
      )}
      <div className="wf-top__titles">
        <h1 className="wf-top__title">{title}</h1>
        {sub && <p className="wf-top__sub">{sub}</p>}
      </div>
      {action ? (
        <button type="button" className="wf-top__action" onClick={action.onPress}>
          {action.word}
        </button>
      ) : (
        <span />
      )}
    </header>
  )
}

export type TabName = 'home' | 'library' | 'scan' | 'queue' | 'find'

/**
 * The word under each icon, and the order they sit in.
 *
 * "Library", not "Shelves". The word a person reads for a piece of furniture
 * is **Bookcase** and the word for a plank is **Area**; "shelf" is a word
 * this code says and this UI never does. See `docs/shelving.md`.
 */
const TABS: { name: TabName; word: string; icon: ReactNode }[] = [
  { name: 'home', word: 'Today', icon: <IconHome /> },
  { name: 'library', word: 'Library', icon: <IconShelves /> },
  { name: 'scan', word: 'Scan', icon: <IconCamera /> },
  { name: 'queue', word: 'Queue', icon: <IconQueue /> },
  { name: 'find', word: 'Find', icon: <IconFind /> },
]

export function TabBar({ on, onPick }: { on: TabName; onPick?: (name: TabName) => void }) {
  return (
    <nav className="wf-tabs" aria-label="Sections">
      {TABS.map((tab) => (
        <button
          key={tab.name}
          type="button"
          className={`wf-tab${tab.name === on ? ' wf-tab--on' : ''}`}
          aria-current={tab.name === on ? 'page' : undefined}
          onClick={() => onPick?.(tab.name)}
        >
          {tab.icon}
          <span className="wf-tab__word">{tab.word}</span>
          <span className="wf-tab__mark" />
        </button>
      ))}
    </nav>
  )
}
