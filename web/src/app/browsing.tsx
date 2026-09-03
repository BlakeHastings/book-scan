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
import type { BookState } from '../../domain/books/state'
import { useNavigation } from './navigation'

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
  /**
   * Which state of book the library is showing, or null for all of them.
   *
   * **A count is a promise about what you will see** (#459). "2 checked out" on
   * the first screen and "27 catalogued" beside it opened the same unfiltered
   * library, so pressing the smaller number produced the larger list and
   * nothing on the screen said what had happened. This is the answer carried
   * from the press to the screen, which is why it is here rather than in
   * `LibraryPane`: the screen that presses is unmounted before the library
   * mounts, which is the reason every other field on this provider is here.
   *
   * A narrowing beside the tags rather than one of them. A tag is something
   * somebody said about a book; being out of the house is something that
   * happened to it, and #395 settles that lending is not a tag.
   */
  readonly showing: BookState | null
  readonly setShowing: (state: BookState | null) => void
  /**
   * Open the library on the books a count was about, or on all of them.
   *
   * Both in one call, because the two apart is how "2 checked out" opened the
   * library on 27: a caller that sets the route and forgets the narrowing is a
   * count that does not keep its promise. `openQueueOn` in `navigation.tsx` is
   * the same shape for the same reason, and #436 is what taught it.
   *
   * Unlike the queue's, the answer is **not** consumed on the way in. It is a
   * narrowing beside the tags and it survives opening a book and coming back,
   * exactly as a chosen tag does, because coming back to the whole collection
   * every time is what "narrowed" would then mean for one screen and not the
   * other. Whichever press wants the whole library says so by passing null.
   */
  readonly openLibraryShowing: (state: BookState | null) => void
  /** The book whose own page is open, if one is. */
  readonly viewing: number
  readonly setViewing: (id: number) => void
  /** What is in the find field, so leaving a result and coming back keeps it. */
  readonly typed: string
  readonly setTyped: (typed: string) => void
}

const Context = createContext<Browsing | null>(null)

export function BrowsingProvider({ children }: { children: ReactNode }) {
  // Navigation is the provider outside this one, which is what lets a narrowing
  // and the route it is for be set together. See `openLibraryShowing`.
  const { setRoute } = useNavigation()
  const [look, setStoredLook] = useState<Look>(() => LOOK_OF[rememberedView()])
  const [narrowing, setNarrowing] = useState<readonly Narrowing[]>([])
  const [showing, setShowing] = useState<BookState | null>(null)
  const [viewing, setViewing] = useState(0)
  const [typed, setTyped] = useState('')

  const value = useMemo<Browsing>(() => ({
    look,
    // Written down as well as remembered, because the library is unmounted the
    // moment a book opens and so cannot remember anything itself.
    setLook: (next) => { setStoredLook(next); rememberView(VIEW_OF[next]) },
    narrowing,
    setNarrowing,
    showing,
    setShowing,
    openLibraryShowing: (state) => { setShowing(state); setRoute('library') },
    viewing,
    setViewing,
    typed,
    setTyped,
  }), [look, narrowing, showing, viewing, typed, setRoute])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useBrowsing(): Browsing {
  const found = useContext(Context)
  if (!found) throw new Error('useBrowsing was called outside BrowsingProvider')
  return found
}
