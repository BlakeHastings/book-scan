/**
 * The corner, and the short list of things that are yours behind it.
 *
 * ## What this is for
 *
 * The furniture screens are good and until now nothing in the app led to them.
 * They sat behind a quiet button at the foot of the shelves screen, which is
 * itself behind a quiet button at the foot of the library, so somebody who
 * wanted to describe a new bookcase had no way to guess where that lived. The
 * owner asked for the fix by shape:
 *
 * > The top right corner should be a profile picture like icon, and then
 * > whenever you select it, it should open up that menu, and in there should
 * > be an option to change fixtures, like "my fixtures", that way it takes
 * > them to the page to edit their fixtures.
 *
 * ## One definition, two callers
 *
 * The corner is on the first screen and on the library, and it is drawn from
 * here on both. Written out per screen it would be two chances for the word,
 * the glyph or the destination to say something slightly different, which is
 * the fault this codebase keeps taking copies off screens for. `Portrait` and
 * `Corner` themselves live in the design system, where the gallery draws the
 * same two.
 *
 * ## Where a person's name would be, the collection is
 *
 * An account menu opens with who you are signed in as; there is nobody to say,
 * so this opens with what you have. That line is what stops the ring above it
 * reading as a login somebody forgot to wire up, and it is the part of #329
 * that survived the owner overruling the cat. See `Portrait` in `Chrome.tsx`.
 *
 * **Nothing here is drawn until it is known.** The books come from the summary
 * the app already holds, and the pieces come from a read of the room made when
 * the menu is opened and not before: a menu on the first screen that fetched
 * the furniture on every visit would be a request per app launch for a line of
 * text nobody has asked to see yet. Until each answers, the line it belongs to
 * is short rather than guessed at.
 *
 * ## Two ways in, and why not three
 *
 * **Your furniture** is the reason this exists, and it is called exactly what
 * the screen it opens is titled: a menu entry disagreeing with its destination
 * is the same fault as two components sharing a name.
 *
 * **Settings** is the owner's own second thought ("preferences, or maybe not
 * preferences, instead settings"). It is the one word in an interface nobody
 * has to be taught, and the point of this change is that things stop being
 * unfindable.
 *
 * Your tags is deliberately not a third row: it is already one press from the
 * top of every library screen, and a second door to a room the screen already
 * opens is the fault the first screen had its camera card taken off for.
 */

import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Corner, Portrait } from '../design/Chrome'
import { useNavigation } from '../app/navigation'
import { useSummary } from '../app/summary'
import { api, type FurnitureDto } from '../lib/api'
import { counted, roomSaid } from '../lib/furniture'
import { grouped } from '../lib/say'

/** The word the corner carries, which is its accessible name and its only one. */
export const ROOM_WORD = 'Your room'

export interface RoomMenu {
  /** The one action in the top right, ready for `TopBar`. */
  action: { word: string; icon: ReactNode; onPress: () => void }
  /** The sheet over the screen, when it is open. Handed to `Phone` as `over`. */
  sheet?: ReactElement
}

/**
 * What the line where a name would be says, given what has come back so far.
 *
 * Exported for its test. Every branch of it is a real state of the app: the
 * counts arrive from a request the first screen makes, the room arrives from
 * one this menu makes when it opens, and either can still be in flight.
 */
export function roomLine(books: number | null, pieces: number | null): string {
  /* Digits for the books and a word for the pieces, which is the line this app
     already draws elsewhere: "1,204 books" is a count and "five pieces" is a
     sentence, and somewhere around a dozen is where one becomes the other. */
  const said = books === null ? '' : `${grouped(books)} ${books === 1 ? 'book' : 'books'}`
  if (pieces === null) return said || 'Everything you own'
  const furniture = `${counted(pieces, 'piece')} of furniture`
  return said ? `${said}, ${furniture}` : furniture
}

export function useRoomMenu(): RoomMenu {
  const { openRoom } = useNavigation()
  const { counts } = useSummary()
  const [open, setOpen] = useState(false)
  const [room, setRoom] = useState<FurnitureDto | null>(null)

  /*
   * Read once, the first time the menu is opened, and kept for the rest of the
   * sitting. A menu that re-read the room on every open would be a request
   * behind a tap that has to feel instant, and the two counts it draws are the
   * kind that change when somebody has just been on the screen it opens, which
   * is the screen that re-reads for itself.
   */
  useEffect(() => {
    if (!open || room) return undefined
    let live = true
    api.furniture()
      .then((answer) => { if (live) setRoom(answer) })
      /* A line of text that could not be read is left out. There is nothing
         here worth putting an error on somebody's first screen for. */
      .catch(() => {})
    return () => { live = false }
  }, [open, room])

  const action = {
    word: ROOM_WORD,
    icon: <Portrait />,
    onPress: () => setOpen(true),
  }

  if (!open) return { action }

  return {
    action,
    sheet: (
      <Corner
        said={roomLine(counts?.total ?? null, room ? room.fixtures.length : null)}
        ways={[
          {
            word: 'Your furniture',
            /* The furniture screen's own second line, word for word, because a
               menu that summarised a screen in its own words would be two
               sentences somebody has to keep agreeing. */
            note: room ? roomSaid(room.fixtures) : undefined,
            onPress: () => { setOpen(false); openRoom('furniture') },
          },
          {
            word: 'Settings',
            note: 'The order they file in, and which hand',
            onPress: () => { setOpen(false); openRoom('settings') },
          },
        ]}
        onClose={() => setOpen(false)}
      />
    ),
  }
}
