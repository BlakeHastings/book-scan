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
 */

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useNavigation } from './navigation'

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
}

const Context = createContext<Arranging | null>(null)

export function ArrangingProvider({ children }: { children: ReactNode }) {
  const { setRoute } = useNavigation()
  const [fixtureId, setFixtureId] = useState<number | null>(null)
  const [areaId, setAreaId] = useState<number | null>(null)

  const openFixture = (id: number) => {
    setFixtureId(id)
    setAreaId(null)
    setRoute('fixture')
  }

  const openArea = (piece: number, area: number) => {
    setFixtureId(piece)
    setAreaId(area)
    setRoute('area')
  }

  return (
    <Context.Provider
      value={{ fixtureId, setFixtureId, areaId, setAreaId, openFixture, openArea }}
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
