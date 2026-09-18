/**
 * Which piece of furniture, and which area of it, the arranging screens are
 * about.
 *
 * Six screens need it and none of them can be given a prop: the route table
 * draws a screen with no arguments, on purpose, so that adding one is a file
 * and a line rather than an edit to something everybody else is also editing.
 *
 * Holds ids and never a label: a label is worked out from a piece's or
 * area's current name at the moment it is read, so a label carried between
 * screens could name something somebody has since renamed.
 *
 * Separate from `navigation` since this is state four screens share and
 * nothing else has any use for.
 *
 * Back is remembered rather than guessed: these screens are each reachable
 * from more than one place, so this holds a trail of the screens somebody
 * walked through, pushed by `onward` and popped by `back`. The room is the
 * floor: every way of landing back on it, including ones that are not a
 * `back` at all, empties the trail.
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
   * On to another screen, with this one remembered as the way back. Every
   * forward step between these screens must go through this or the two
   * openers above, or `back` cannot undo it correctly.
   */
  onward: (to: Route) => void
  /**
   * A screen that takes the place of this one rather than standing on top
   * of it, so back still means the screen underneath. Used when the
   * screen that sent you here is finished with, such as landing on the
   * area you just cut.
   */
  instead: (to: Route) => void
  /**
   * Back to the screen this one was opened from. `fallback` is for a
   * screen nothing recorded a way into.
   */
  back: (fallback: Route) => void
}

const Context = createContext<Arranging | null>(null)

export function ArrangingProvider({ children }: { children: ReactNode }) {
  const { route, setRoute } = useNavigation()
  const [fixtureId, setFixtureId] = useState<number | null>(null)
  const [areaId, setAreaId] = useState<number | null>(null)
  const [trail, setTrail] = useState<Route[]>([])

  // The floor: nothing is under the room, so anything left on the trail
  // once you arrive here is stale.
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
