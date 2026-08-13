/**
 * The books somebody is holding, which is the one thing in this flow that is
 * not in the database.
 *
 * ## Nothing is written between lifting a book and putting it down
 *
 * A book in your hand is nowhere. Between coming off `4A` and going onto `3A` it
 * is on neither, and the app says nothing about the gap on purpose: the last
 * thing recorded is still true, because it is the last place a person put the
 * book. Recording "in somebody's hand" would be the app asserting something
 * nobody told it, and it would still be asserting it three weeks later.
 *
 * So there is no "I have picked it up" step to be got wrong, nothing to unwind
 * when the phone locks, and putting an armful back on the area it came off costs
 * one state change here and no request at all. This provider is the whole of
 * what the interface knows about the gap.
 *
 * ## The trip is fixed once the books are lifted, and only then
 *
 * The list is recomputed every time it is drawn, which is what makes stopping
 * halfway free. **The screen naming an area for the book in your hand must never
 * be re-answered underneath you**, though, so the armful is taken once and held:
 * the books and both ends of the walk are settled at the moment somebody says
 * they have them, and nothing reloads them until the armful is empty.
 *
 * Saying an area is full is the one case where the answer does change while
 * somebody is standing there, and that is a person changing it themselves. It
 * belongs to the placing screen, where the cascade in `docs/shelving.md` already
 * asks one question at a time.
 *
 * ## Why this is a provider and not state on a screen
 *
 * Four screens are one job here: the list, the area the books come off, one book
 * being placed, and the trip finished. A screen unmounts the moment the route
 * changes (`App.tsx`), so an armful held by any one of them would be dropped on
 * the way to the next.
 */

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react'
import type { CarriedBook, CarryTrip } from '../lib/api'

export interface Armful {
  /** The trip being looked at or walked. Null when nobody has chosen one. */
  readonly trip: CarryTrip | null
  /**
   * The books taken off the area, in the order they will be placed.
   *
   * Fixed at the moment they were lifted. Empty while somebody is only looking
   * at a trip, which is the state that writes nothing and promises nothing.
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
   * Put the whole armful back where it came from.
   *
   * Free, and honest, because nothing was recorded for the books still in the
   * air. The ones already down stay down: they are on the shelves and they are
   * written down, which is what lets somebody walk away mid-trip.
   */
  readonly putBack: () => void
}

const Context = createContext<Armful | null>(null)

export function ArmfulProvider({ children }: { children: ReactNode }) {
  const [trip, setTrip] = useState<CarryTrip | null>(null)
  const [books, setBooks] = useState<CarriedBook[]>([])
  const [done, setDone] = useState(0)

  /*
   * Every one of these is stable, and that is load bearing rather than tidy.
   * Four screens call `api.carry()` from an effect that lists one of them among
   * its dependencies, and a callback rebuilt whenever the armful changed would
   * make each of those effects run again on every book put down.
   */
  const choose = useCallback((chosen: CarryTrip) => {
    setTrip(chosen)
    setBooks([])
    setDone(0)
  }, [])
  const pickUp = useCallback((taken: CarriedBook[]) => { setBooks(taken); setDone(0) }, [])
  const placed = useCallback(() => setDone((at) => at + 1), [])
  const putBack = useCallback(() => { setBooks([]); setDone(0) }, [])

  const value = useMemo<Armful>(
    () => ({ trip, books, done, choose, pickUp, placed, putBack }),
    [trip, books, done, choose, pickUp, placed, putBack],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useArmful(): Armful {
  const found = useContext(Context)
  if (!found) throw new Error('useArmful was called outside ArmfulProvider')
  return found
}
