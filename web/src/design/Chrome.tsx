/**
 * The frame of a screen: what is above the content and what is below it.
 *
 * The top bar is one line of book face and, where the screen is somewhere you
 * arrived at rather than somewhere you live, a back target the full 44px
 * wide. The tab bar carries a word under every icon, always.
 *
 * The corner is the exception: it takes a glyph rather than a word, but the
 * icon still carries its word as its accessible name, so it is announced and
 * findable by voice control. This applies to the avatar (`Portrait`) too.
 */

import type { ReactNode } from 'react'
import { IconBack, IconCamera, IconHome, IconOnward, IconPerson, IconQueue, IconShelves } from './Icons'

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

/**
 * The round thing in the corner: a profile icon, and the account it must not
 * promise. The glyph is `IconPerson`, a head and shoulders and deliberately
 * nothing more: no initials, no photograph, nothing that reads as a
 * particular person, since there are no accounts, no session and no password.
 * It is a door to your own fixtures, not a statement about who is using the
 * app, so the name announced is "Your fixtures", not "You" or "Account". See
 * `Corner`.
 */
export function Portrait() {
  return (
    <span className="wf-portrait">
      <IconPerson size={20} />
    </span>
  )
}

/** The one word the corner, its menu row and the screen they both lead to all say, so a fourth caller cannot quietly say something else. */
export const FIXTURES_WORD = 'Your fixtures'

/**
 * What the corner opens: the short list of things that are yours. It opens
 * with the collection where a person's name would be, since there is no
 * account to be signed in as. Sign-out (`out`) is drawn apart from the ways,
 * without a chevron, since it is the one row here that does not open
 * anything; see `docs/the-gate.md` for why it must be reachable, the session
 * belongs to whoever holds the cookie. `said` and each `note` are given
 * rather than computed here, and an absent note draws as nothing rather than
 * a guess.
 */
export function Corner({
  said,
  ways,
  out,
  onClose,
}: {
  /** What the collection is, said where a person's name would be. */
  said: string
  ways: { word: string; note?: string; onPress?: () => void }[]
  /** The one thing here that leaves rather than opens: signing out. Optional: a sheet with nothing to sign out of draws nothing rather than a dead row. */
  out?: { word: string; note?: string; onPress?: () => void }
  onClose?: () => void
}) {
  return (
    <div className="wf-corner" role="dialog" aria-modal="true" aria-label={FIXTURES_WORD}>
      <button
        type="button"
        className="wf-corner__away"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="wf-corner__card">
        <div className="wf-corner__who">
          <Portrait />
          <span className="wf-corner__lines">
            <span className="wf-corner__name">{FIXTURES_WORD}</span>
            <span className="wf-corner__said">{said}</span>
          </span>
        </div>

        <div className="wf-corner__ways">
          {ways.map((way) => (
            <button
              type="button"
              className="wf-corner__way"
              key={way.word}
              onClick={way.onPress}
            >
              <span className="wf-corner__lines">
                <span className="wf-corner__word">{way.word}</span>
                {way.note && <span className="wf-corner__note">{way.note}</span>}
              </span>
              <IconOnward size={18} />
            </button>
          ))}
        </div>

        {out && (
          <button type="button" className="wf-corner__out" onClick={out.onPress}>
            <span className="wf-corner__lines">
              <span className="wf-corner__word">{out.word}</span>
              {out.note && <span className="wf-corner__note">{out.note}</span>}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

export type TabName = 'home' | 'library' | 'scan' | 'queue'

/**
 * The word under each icon, and the order they sit in.
 *
 * "Library", not "Shelves": the word a person reads for a piece of furniture
 * is Bookcase and the word for a plank is Area; "shelf" is a word this code
 * says and this UI never does. See `docs/shelving.md`.
 *
 * Finding is deliberately not a tab: a tab is a place you can be, and looking
 * for a book is something you do to what you are already looking at, so it
 * lives in the library's filter row instead. See `Filter` in `Finding.tsx`.
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
