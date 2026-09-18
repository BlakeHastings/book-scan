/**
 * What somebody is looking at in the library, and which book they opened.
 *
 * Three screens share this and none of them can hold it: choosing a tag
 * happens on the tags screen, the books it narrows are drawn on the
 * library screen, and opening one unmounts both.
 *
 * A provider of its own rather than four more fields on navigation, since
 * it is about the collection rather than about which screen is on.
 *
 * Nothing here is persisted except the way of looking, which has its own
 * home in `lib/libraryView.ts`: a filter is a question somebody is asking
 * now, not something to hand back on a fresh morning.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Look } from '../design/Finding'
import { rememberedView, rememberView, type LibraryView } from '../lib/libraryView'
import type { BookState } from '../../domain/books/state'
import { useNavigation } from './navigation'

/**
 * The stored answer and the drawn one are the same three views under two
 * sets of names. Translated rather than renamed, so somebody who chose a
 * view before this screen was converted opens on the view they chose.
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
   * Carried from the press to the screen: the screen that presses is
   * unmounted before the library mounts, which is why this and every
   * other field on this provider live here rather than on the screen.
   *
   * A narrowing beside the tags rather than one of them: a tag is
   * something somebody said about a book, while being out of the house is
   * something that happened to it.
   */
  readonly showing: BookState | null
  readonly setShowing: (state: BookState | null) => void
  /**
   * Open the library on the books a count was about, or on all of them.
   * Both in one call, since setting the route and forgetting the
   * narrowing separately is how a count stops keeping its promise.
   *
   * Unlike the queue's, the answer is not consumed on the way in: it
   * survives opening a book and coming back, exactly as a chosen tag
   * does. Whichever press wants the whole library says so by passing null.
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
  // Navigation is the provider outside this one, which is what lets a
  // narrowing and the route it is for be set together.
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
