import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Corner, FIXTURES_WORD, Portrait } from '../design/Chrome'
import { useGate } from '../app/gate'
import { useNavigation } from '../app/navigation'
import { useSummary } from '../app/summary'
import { api, type FurnitureDto } from '../lib/api'
import { counted, roomSaid } from '../lib/furniture'
import { grouped } from '../lib/say'

export interface RoomMenu {
  /** The one action in the top right, ready for `TopBar`. */
  action: { word: string; icon: ReactNode; onPress: () => void }
  /** The sheet over the screen, when it is open. Handed to `Phone` as `over`. */
  sheet?: ReactElement
}

/**
 * Exported for its test. Both arguments can be null independently, while
 * their own requests are still in flight; every combination is a real state,
 * not an error.
 */
export function roomLine(books: number | null, pieces: number | null): string {
  // Digits for books, a word for pieces: matches the format this app already
  // uses elsewhere for each.
  const said = books === null ? '' : `${grouped(books)} ${books === 1 ? 'book' : 'books'}`
  if (pieces === null) return said || 'Everything you own'
  const fixtures = counted(pieces, 'fixture')
  return said ? `${said}, ${fixtures}` : fixtures
}

/** Exported for its test, like `roomLine` above; every branch is a real state, including an empty address when the provider sent none. */
export function signOutNote(email: string, going: Going): string | undefined {
  if (going === 'going') return 'Signing out.'
  if (going === 'refused') return 'That did not work. Try again.'
  return email || undefined
}

/** Where the sign-out press has got to. */
type Going = 'no' | 'going' | 'refused'

export function useRoomMenu(): RoomMenu {
  const { openRoom } = useNavigation()
  const { counts } = useSummary()
  const { answer, signOut } = useGate()
  const [open, setOpen] = useState(false)
  const [going, setGoing] = useState<Going>('no')
  const [room, setRoom] = useState<FurnitureDto | null>(null)

  // Fetched once, on first open, and cached for the session: re-reading on
  // every open would put a request behind a tap that must feel instant.
  useEffect(() => {
    if (!open || room) return undefined
    let live = true
    api.furniture()
      .then((answer) => { if (live) setRoom(answer) })
      // Deliberately silent: an error here is not worth surfacing on the first screen.
      .catch(() => {})
    return () => { live = false }
  }, [open, room])

  const action = {
    word: FIXTURES_WORD,
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
            word: FIXTURES_WORD,
            // Same words as the fixtures screen's own second line: two
            // independent summaries would drift apart.
            note: room ? roomSaid(room.fixtures) : undefined,
            onPress: () => { setOpen(false); openRoom('furniture') },
          },
          {
            word: 'Settings',
            note: 'The order they file in, and which hand',
            onPress: () => { setOpen(false); openRoom('settings') },
          },
        ]}
        out={{
          word: 'Sign out',
          note: signOutNote(answer?.user?.email ?? '', going),
          onPress: () => {
            setGoing('going')
            // Deliberately not closed first: success replaces the whole
            // screen, and failure must leave the refusal visible.
            void signOut().catch(() => setGoing('refused'))
          },
        }}
        onClose={() => setOpen(false)}
      />
    ),
  }
}
