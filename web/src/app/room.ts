/**
 * Reading the room, and writing to it.
 *
 * Six screens ask the same question of the server, which is "what does the
 * furniture look like now", and every one of them has to ask it again after
 * every write. That is not a caching miss to be fixed: **a label is worked out
 * at read time**, so a rename or a renumber changes what other pieces are
 * called as well as this one, and a screen that kept the answer would draw the
 * old names until somebody navigated away and back.
 *
 * So there is one hook, it re-reads after every write it makes, and there is
 * nowhere in it to keep a label.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type FurnitureDto } from '../lib/api'
import type { TabName } from '../design/Chrome'
import { useLeaving } from './leaving'

export interface Room {
  /** The room as the server last described it, or null before it has answered. */
  room: FurnitureDto | null
  /** Whatever refused the last write, in its own words. */
  error: string
  setError: (said: string) => void
  busy: boolean
  read: () => Promise<void>
  /**
   * Do something to the room and read it back.
   *
   * Answers whether it worked, so a screen can decide what to do next without
   * having to catch anything itself, and it holds the refusal for drawing. The
   * refusal is thrown on again for the one caller that needs the body of it,
   * which is a strategy change being asked to acknowledge what it does.
   */
  write: <T>(what: () => Promise<T>) => Promise<T | null>
}

export function useRoom(): Room {
  const [room, setRoom] = useState<FurnitureDto | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const read = useCallback(async () => {
    try {
      setRoom(await api.furniture())
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [])

  useEffect(() => { void read() }, [read])

  const write = useCallback(async <T,>(what: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    setError('')
    try {
      const done = await what()
      await read()
      return done
    } catch (caught) {
      setError((caught as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }, [read])

  return { room, error, setError, busy, read, write }
}

/**
 * The page under a screen drawn with the design system takes its paper.
 *
 * `body.wf-page` in `design/library.css`: the app paints `html, body` a cold
 * dark blue-grey, which otherwise shows either side of the 480px column and
 * under an overscroll bounce. The same two lines the first screen carries.
 */
export function useDesignPage(): void {
  useEffect(() => {
    document.body.classList.add('wf-page')
    return () => document.body.classList.remove('wf-page')
  }, [])
}

/**
 * Where the four tabs go from an arranging screen.
 *
 * Through `leaveFor` rather than straight to the route, because every one of
 * these is a way out of whatever else is on: a tab that only changed the route
 * would leave a capture claimed by somebody who has walked away.
 */
export function useRoomTabs(): Record<TabName, () => void> {
  const { leaveFor } = useLeaving()
  return {
    home: () => leaveFor('home'),
    library: () => leaveFor('library'),
    scan: () => leaveFor('capture'),
    queue: () => leaveFor('queue'),
  }
}
