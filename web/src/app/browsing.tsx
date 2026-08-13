/**
 * What somebody is looking at in the library, and which book they opened.
 *
 * Three screens share this and none of them can hold it: choosing a tag happens
 * on the tags screen, the books it narrows are drawn on the library screen, and
 * opening one unmounts both. That is the same reason the library's return anchor
 * lives in `navigation.tsx` rather than in `ShelfView`.
 *
 * It is a provider of its own rather than four more fields on navigation,
 * because it is about the collection rather than about which screen is on, and
 * because navigation is a file four screens are being built against at once.
 *
 * **Nothing here is persisted except the way of looking**, which has its own
 * home in `lib/libraryView.ts` and has had since #82. A filter is a question
 * somebody is asking now; being handed yesterday's narrowed library on a fresh
 * morning is the complaint that made the view persist in the first place, said
 * the other way round.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Look } from '../design/Finding'
import { rememberedView, rememberView, type LibraryView } from '../lib/libraryView'

/**
 * The stored answer and the drawn one are the same three views under two sets of
 * names, and the stored ones are older than the design system.
 *
 * Translated rather than renamed, so somebody who chose a view before this
 * screen was converted opens on the view they chose.
 */
const LOOK_OF: Record<LibraryView, Look> = {
  shelf: 'spines',
  list: 'list',
  gallery: 'covers',
}

const VIEW_OF: Record<Look, LibraryView> = {
  spines: 'shelf',
  list: 'list',
  covers: 'gallery',
}

/** One tag the library is narrowed to: the identity, and the word for it. */
export interface Narrowing {
  /** The identity. No screen ever draws this. */
  slug: string
  /** What a person reads. */
  label: string
}

export interface Browsing {
  /** Which of the three ways of looking at the books is on. */
  readonly look: Look
  readonly setLook: (look: Look) => void
  /** The tags narrowing the library. Empty is every book. */
  readonly narrowing: readonly Narrowing[]
  readonly setNarrowing: (tags: readonly Narrowing[]) => void
  /** The book whose own page is open, if one is. */
  readonly viewing: number
  readonly setViewing: (id: number) => void
  /** What is in the find field, so leaving a result and coming back keeps it. */
  readonly typed: string
  readonly setTyped: (typed: string) => void
}

const Context = createContext<Browsing | null>(null)

export function BrowsingProvider({ children }: { children: ReactNode }) {
  const [look, setStoredLook] = useState<Look>(() => LOOK_OF[rememberedView()])
  const [narrowing, setNarrowing] = useState<readonly Narrowing[]>([])
  const [viewing, setViewing] = useState(0)
  const [typed, setTyped] = useState('')

  const value = useMemo<Browsing>(() => ({
    look,
    // Written down as well as remembered, because the library is unmounted the
    // moment a book opens and so cannot remember anything itself.
    setLook: (next) => { setStoredLook(next); rememberView(VIEW_OF[next]) },
    narrowing,
    setNarrowing,
    viewing,
    setViewing,
    typed,
    setTyped,
  }), [look, narrowing, viewing, typed])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useBrowsing(): Browsing {
  const found = useContext(Context)
  if (!found) throw new Error('useBrowsing was called outside BrowsingProvider')
  return found
}
