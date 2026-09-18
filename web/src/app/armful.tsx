/**
 * The books somebody is holding, which is the one thing in this flow that
 * is not in the database.
 *
 * Nothing is written between lifting a book and putting it down: a book in
 * hand is nowhere, on neither the plank it came off nor the one it is
 * going to, and the app says nothing about the gap on purpose. There is no
 * "I have picked it up" step to be got wrong, nothing to unwind when the
 * phone locks, and putting an armful back costs one state change and no
 * request at all.
 *
 * The trip is fixed once the books are lifted, and only then: the list is
 * recomputed every time it is drawn, but the armful itself is taken once
 * and held, since the screen naming an area for the book in hand must
 * never be re-answered underneath somebody mid-placement.
 *
 * A provider rather than screen state, since four screens (the list, the
 * area the books come off, one book being placed, and the trip finished)
 * are one job here, and a screen unmounts the moment the route changes.
 */

import {
  createContext, useCallback, useContext, useMemo, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import { emptyCascade, type Cascade } from '../lib/cascade'
import type { CarriedBook, CarryTrip } from '../lib/api'

export interface Armful {
  /** The trip being looked at or walked. Null when nobody has chosen one. */
  readonly trip: CarryTrip | null
  /**
   * The books taken off the area, in the order they will be placed. Fixed
   * at the moment they were lifted. Empty while somebody is only looking
   * at a trip, which writes nothing and promises nothing.
   */
  readonly books: CarriedBook[]
  /** How many of them are down, which is also the index of the next one. */
  readonly done: number
  /** Look at a trip, without claiming to be holding anything. */
  readonly choose: (trip: CarryTrip) => void
  /** Say the books are off the shelf. Records nothing: they are nowhere. */
  readonly pickUp: (books: CarriedBook[]) => void
  /** One book is down and written down. */
  readonly placed: () => void
  /**
   * Put the whole armful back where it came from. Free, since nothing was
   * recorded for the books still in the air. The ones already down stay
   * down, since they are written down, which is what lets somebody walk
   * away mid-trip.
   */
  readonly putBack: () => void
  /**
   * The shuffle a full plank started while the book at the front of the
   * armful was being placed. Held here rather than on the placing screen,
   * since that screen does not unmount between one book and the next: the
   * thing that knows when the book in hand changes is this, so every call
   * below that moves the armful on clears it.
   */
  readonly cascade: Cascade
  readonly setCascade: Dispatch<SetStateAction<Cascade>>
}

const Context = createContext<Armful | null>(null)

export function ArmfulProvider({ children }: { children: ReactNode }) {
  const [trip, setTrip] = useState<CarryTrip | null>(null)
  const [books, setBooks] = useState<CarriedBook[]>([])
  const [done, setDone] = useState(0)
  const [cascade, setCascade] = useState<Cascade>(emptyCascade)

  /*
   * Every one of these is stable, and that is load bearing: four screens
   * call `api.carry()` from an effect that lists one of them as a
   * dependency, and a callback rebuilt on every change would rerun those
   * effects on every book put down.
   */
  const choose = useCallback((chosen: CarryTrip) => {
    setTrip(chosen)
    setBooks([])
    setDone(0)
    setCascade(emptyCascade)
  }, [])
  const pickUp = useCallback((taken: CarriedBook[]) => {
    setBooks(taken)
    setDone(0)
    setCascade(emptyCascade)
  }, [])
  const placed = useCallback(() => {
    setDone((at) => at + 1)
    setCascade(emptyCascade)
  }, [])
  const putBack = useCallback(() => {
    setBooks([])
    setDone(0)
    setCascade(emptyCascade)
  }, [])

  const value = useMemo<Armful>(
    () => ({ trip, books, done, choose, pickUp, placed, putBack, cascade, setCascade }),
    [trip, books, done, choose, pickUp, placed, putBack, cascade],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useArmful(): Armful {
  const found = useContext(Context)
  if (!found) throw new Error('useArmful was called outside ArmfulProvider')
  return found
}
