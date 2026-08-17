/**
 * Which piece of furniture, and which area of it, the arranging screens are
 * about.
 *
 * Six screens need it and none of them can be given a prop: the route table
 * draws a screen with no arguments, on purpose, so that adding one is a file
 * and a line rather than an edit to something everybody else is also editing.
 *
 * ## It holds ids and never a label
 *
 * The whole of what is kept here is two numbers. A label is worked out from a
 * piece's number and name and an area's ordinal and name at the moment it is
 * read, so a label carried between screens is a name for something somebody may
 * have renamed in between; every screen re-reads the room and takes the label
 * off the answer. That is the rule these screens exist to respect, and the
 * cheapest way to keep it is to have nowhere to put a stale one.
 *
 * ## Why not `navigation`
 *
 * The same reason the providers are split by what they are about rather than
 * gathered into one store: this is state four screens share and nothing else
 * has any use for, and `navigation` is where the route lives and where three
 * other groups of screens are landing at the same time.
 *
 * ## Back is the screen you came from, and it is remembered rather than guessed
 *
 * Every one of these screens is reachable from more than one place, and each of
 * them used to name its own way out: cutting an area went back to the piece's
 * edit page however you had got there, so walking in from the room and pressing
 * back landed you a screen deeper than you started (#367). An area is reachable
 * from the room and from a piece, and "what belongs here" is reachable from an
 * area and from the screen that says why a book is where it is, so the same
 * guess was wrong in three more places.
 *
 * So this holds a **trail**: the screens somebody walked through to get here,
 * pushed by `onward` and popped by `back`. It is the mechanism `navigation`
 * already uses for the four doors it owns (`arrangeBack`, `claimBack`,
 * `roomBack`, `scanBack`), with one difference that earns it: these screens
 * nest, so remembering one caller each is not enough. Three screens deep,
 * pressing back twice has to walk out the way you walked in.
 *
 * **The room is the floor.** Standing on it there is nothing underneath, which
 * is what keeps the trail from growing across a session: every way of landing
 * back on the room empties it, including the ones that are not a `back` at all,
 * like saving a piece and like the corner's menu opening the room from outside
 * these screens entirely.
 */

import {
  createContext, useContext, useEffect, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import { useNavigation, type Route } from './navigation'

export interface Arranging {
  /** The piece being looked at, or null on the way in. */
  fixtureId: number | null
  setFixtureId: Dispatch<SetStateAction<number | null>>
  /** The area being looked at, or null when the screen is about a piece. */
  areaId: number | null
  setAreaId: Dispatch<SetStateAction<number | null>>
  /** Open a piece, from the room or from an area's top bar. */
  openFixture: (id: number) => void
  /** Open an area, which is always an area of some piece. */
  openArea: (fixtureId: number, areaId: number) => void
  /**
   * On to another screen, with this one remembered as the way back.
   *
   * Every forward step between these screens goes through this or through the
   * two openers above, because a step that does not is a step `back` cannot
   * undo: it would pop whatever the screen before had put there and land
   * somebody two screens out.
   */
  onward: (to: Route) => void
  /**
   * A screen that takes the place of this one rather than standing on top of
   * it, so back still means the screen underneath.
   *
   * Landing on the area you have just cut, or on the piece an area was just
   * removed from: the screen that sent you there is finished with, and pushing
   * it would make back offer to do the thing again.
   */
  instead: (to: Route) => void
  /**
   * Back to the screen this one was opened from.
   *
   * `fallback` is for a screen nothing recorded a way into, which is not a case
   * these screens have today and is still not a thing to leave a person stuck
   * in.
   */
  back: (fallback: Route) => void
}

const Context = createContext<Arranging | null>(null)

export function ArrangingProvider({ children }: { children: ReactNode }) {
  const { route, setRoute } = useNavigation()
  const [fixtureId, setFixtureId] = useState<number | null>(null)
  const [areaId, setAreaId] = useState<number | null>(null)
  const [trail, setTrail] = useState<Route[]>([])

  // The floor. Nothing is under the room, whichever of the several ways of
  // arriving on it was taken, so anything left on the trail is stale.
  useEffect(() => {
    if (route === 'furniture') setTrail((walked) => (walked.length ? [] : walked))
  }, [route])

  const onward = (to: Route) => {
    setTrail((walked) => [...walked, route])
    setRoute(to)
  }

  const instead = (to: Route) => setRoute(to)

  const back = (fallback: Route) => {
    setRoute(trail[trail.length - 1] ?? fallback)
    setTrail(trail.slice(0, -1))
  }

  const openFixture = (id: number) => {
    setFixtureId(id)
    setAreaId(null)
    onward('fixture')
  }

  const openArea = (piece: number, area: number) => {
    setFixtureId(piece)
    setAreaId(area)
    onward('area')
  }

  return (
    <Context.Provider
      value={{
        fixtureId, setFixtureId, areaId, setAreaId,
        openFixture, openArea, onward, instead, back,
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useArranging(): Arranging {
  const found = useContext(Context)
  if (!found) throw new Error('useArranging was called outside ArrangingProvider')
  return found
}
