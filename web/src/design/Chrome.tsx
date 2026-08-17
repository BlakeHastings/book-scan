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
 *
 * **An avatar is an icon and the rule reaches it too.** On the screens a
 * person lives on, the corner is now `Portrait`, and a picture is the one kind
 * of glyph somebody is tempted to leave unnamed because it looks like a thing
 * rather than a symbol. It carries its word the same way the search glyph
 * does. See `Portrait` for what is in it and what it must not promise.
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
 * promise.
 *
 * The owner asked for the corner to become an avatar:
 *
 * > The top right corner should be a profile picture like icon, and then
 * > whenever you select it, it should open up that menu, and in there should
 * > be an option to change fixtures [...] We're gonna use that in the future
 * > whenever we have a multi user set up, but we're not there yet.
 *
 * ## The drawing said the cat, the owner said the person, and that is settled
 *
 * #329 drew the cat here rather than a face, and the argument was that an
 * avatar's whole job is to say which person is signed in: #171 is deferred,
 * there are no accounts, no session and no password, so a face in this ring is
 * a portrait of somebody who does not exist and the first tap goes looking for
 * "Sign out" and finds furniture.
 *
 * **The owner read that and chose the other way** (#350), knowing the reason
 * and giving his own in the same breath: multi-user is coming and this is the
 * shape that will be right when it does. Choosing what will be right later
 * over what is honest today is his call, not this file's, and it is written
 * down here so nobody quietly puts the cat back in six months.
 *
 * ## What the drawing got right is kept underneath it, and it is most of it
 *
 * The damage a face does is real whoever decided on it, so every part of #329
 * that was aimed at the damage rather than at the sitter stays:
 *
 * - **The menu opens with the collection where a name would be.** An account
 *   menu opens with who you are signed in as; this one opens with what you
 *   have, which is the honest answer to the same question and is what stops
 *   the ring above reading as a login somebody forgot to wire up.
 * - **Settings says it plainly, once**, at the place somebody hunting for the
 *   account finally arrives: everybody in the house shares one collection.
 * - **There is no sign-in anywhere.** Not a door, not an account name, and
 *   nothing greyed out and labelled coming soon. #171 is a decision nobody has
 *   made and drawing a door for it would be this making it.
 *
 * So the glyph is `IconPerson`, which is a head and a pair of shoulders and
 * deliberately nothing more: no initials, no photograph and no silhouette with
 * a haircut. Anything that reads as a *particular* person is the claim this
 * must not make. **It is a door to your own fixtures, not a statement about
 * who is using the app.**
 *
 * The name announced is **Your fixtures**, not "You" and not "Account", and
 * the name did not change when the sitter did: the thing behind this target
 * is still the collection and the books in it. See `Corner`.
 */
export function Portrait() {
  return (
    <span className="wf-portrait">
      <IconPerson size={20} />
    </span>
  )
}

/**
 * The one word the corner, its menu row and the screen they both lead to all
 * say, so a fourth caller cannot quietly say something else.
 *
 * ## Furniture lost to fixtures, and that is settled
 *
 * #333 named this menu **Your furniture**, deliberately over "My fixtures",
 * and gave its reason in the same breath: it is what the screen it opens is
 * titled, this app says "your" and never "my", and "a fixture is a landlord's
 * word for a thing; furniture is what you say about your own room." The
 * corner itself was **Your room**, for the same reason a face was the cat:
 * there is no account to say who "you" are, so the menu opened with what you
 * have rather than who you are.
 *
 * **The owner overruled both** (#362), and he had already said the same thing
 * once before, about the pieces themselves rather than the room they stand
 * in: "they're not bookcases, they are fixtures" (#272). Room and furniture
 * are both words for something this app does not have; fixtures is the word
 * it has actually used since #272 for what is really in it. So the corner,
 * the menu row and the screen they lead to all say **Your fixtures**, one
 * word in three places, and #333's reason for the old words is kept here
 * rather than deleted, so the next person who reaches for "furniture" or
 * "room" finds out why they left before putting either back.
 */
export const FIXTURES_WORD = 'Your fixtures'

/**
 * What the corner opens: the short list of things that are yours.
 *
 * ## Where a person's name would be, the collection is
 *
 * An account menu opens with who you are signed in as. This one opens with
 * what you have, because that is the honest answer to the same question, and
 * because a menu that simply started with two rows would leave the ring above
 * it looking like a login somebody forgot to build. There is no "sign out",
 * not greyed out and not "coming soon": #171 is a decision nobody has made,
 * and drawing a door for it here would be this wireframe making it.
 *
 * ## Two ways in, and why not three
 *
 * **Your fixtures** is the whole reason this exists: those screens are good
 * and nothing led to them. It is called what the screen it opens is called,
 * and what the corner above it is called too, because a menu entry and its
 * destination disagreeing about the name of a thing is the same fault as two
 * components sharing one. See `FIXTURES_WORD` for that name and for the
 * argument #362 overruled to arrive at it.
 *
 * **Settings** is the owner's own second thought ("preferences, or maybe not
 * preferences, instead settings") and it is kept, because it is the one word
 * in an interface nobody has to be taught, and the point of this change is
 * that things stop being unfindable.
 *
 * Your tags is deliberately not a third row. It is already one press from the
 * top of every library screen, and a second door to a room the screen already
 * opens is the fault the first screen had its camera card taken off for.
 *
 * ## It closes by being tapped away from
 *
 * The way out is the whole of the rest of the screen, which is how every sheet
 * like this behaves and is why the screen under it is drawn in full rather
 * than hidden. It is a real target here rather than a scrim with a handler on
 * it, so the wireframe can be walked out of as well as into.
 *
 * ## Every line on it is given rather than written here
 *
 * `said` and each `note` are counts of somebody's own collection, so this
 * draws what it is handed and invents nothing. **A note is optional and an
 * absent one is drawn as nothing at all**, which is what the app needs while
 * the room is still being read: a menu that guessed at "five pieces" for the
 * length of one request would be saying something false about a house.
 */
export function Corner({
  said,
  ways,
  onClose,
}: {
  /** What the collection is, said where a person's name would be. */
  said: string
  ways: { word: string; note?: string; onPress?: () => void }[]
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
      </div>
    </div>
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
 * thing you are already looking at.
 *
 * It went to the library's top right, and #329 moved it one row further down
 * for the same reason it left the tab bar: the corner is now the portrait, and
 * find belongs with the row that already says which books you are looking at.
 * The glyph has not changed and neither has the count of presses; see `Filter`
 * in `Finding.tsx` for the measurement.
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
