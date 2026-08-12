/**
 * The frame of a screen: what is above the content and what is below it.
 *
 * The top bar is one line of book face and, where the screen is somewhere you
 * arrived at rather than somewhere you live, a back target the full 44px
 * wide. The tab bar carries a word under every icon, always: an icon on its
 * own is a guess the reader makes on every visit, and five guesses is a menu
 * nobody trusts.
 *
 * ## The corner is the exception, and it is the owner's call
 *
 * This file used to say the top right was "one word, never an icon on its
 * own". Walking the first round he asked for the opposite, twice and by name:
 * find should be a search icon, and edit should be an icon too. So the corner
 * takes a glyph, and the rule that survives is the one underneath it: **an
 * icon there carries its word as its accessible name**, so it is announced,
 * findable by voice control and readable by anything that is not looking at
 * pixels.
 *
 * The tab bar is untouched by that. Five icons on a strip with no words is the
 * guessing game above; one icon in a corner, on a screen whose title already
 * says what you are looking at, is not.
 */

import type { ReactNode } from 'react'
import { IconBack, IconCamera, IconHome, IconQueue, IconShelves } from './Icons'

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
  /**
   * The one action in the top right. A glyph, and `word` is what it is called:
   * the accessible name, not something drawn. There is never a second one.
   */
  action?: { word: string; icon: ReactNode; onPress?: () => void }
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
        <button
          type="button"
          className="wf-top__action"
          onClick={action.onPress}
          aria-label={action.word}
          title={action.word}
        >
          {action.icon}
        </button>
      ) : (
        <span />
      )}
    </header>
  )
}

export type TabName = 'home' | 'library' | 'scan' | 'queue'

/**
 * The word under each icon, and the order they sit in.
 *
 * "Library", not "Shelves". The word a person reads for a piece of furniture
 * is **Bookcase** and the word for a plank is **Area**; "shelf" is a word
 * this code says and this UI never does. See `docs/shelving.md`.
 *
 * ## There are four, and finding is not one of them
 *
 * Find had a tab of its own and the owner took it off:
 *
 * > I think we should just have the find system as part of the library rather
 * > than a completely separate system.
 *
 * He is right, and the reason generalises. A tab is a *place you can be*, and
 * looking for a book is not somewhere you go, it is something you do to the
 * thing you are already looking at. It now lives where it is done, as the one
 * action in the library's top right, and the search icon in `Icons.tsx` is
 * still the same glyph doing the same job in a better spot.
 */
const TABS: { name: TabName; word: string; icon: ReactNode }[] = [
  { name: 'home', word: 'Today', icon: <IconHome /> },
  { name: 'library', word: 'Library', icon: <IconShelves /> },
  { name: 'scan', word: 'Scan', icon: <IconCamera /> },
  { name: 'queue', word: 'Queue', icon: <IconQueue /> },
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
