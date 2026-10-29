/**
 * Where the phone's back gesture goes: to whatever drew the way back nearest
 * the top. A dialog or the whole picture is over the screen, so it closes
 * before the screen's own back arrow is asked.
 *
 * Nothing registers anything outside the provider, which is how the gallery
 * draws every screen without a history to keep.
 */

import {
  createContext, useContext, useEffect, useMemo, useReducer, useRef,
  type ReactNode,
} from 'react'
import { BackGuard } from '../lib/backGuard'

/** `over` is a dialog or a picture opened over a screen; it answers before the screen does. */
export type BackLayer = 'screen' | 'over'

interface Way {
  layer: BackLayer
  order: number
  run: () => void
}

interface Registry {
  add(layer: BackLayer, run: () => void): () => void
}

const Context = createContext<Registry | null>(null)

/** For a dialog with no quiet way out: back keeps it open rather than leaving the screen under it. */
export const stay = () => {}

/**
 * Make the phone's back gesture do `run` while this is drawn. Pass the same
 * function the on-screen way back calls, so the two cannot disagree. Nothing
 * is registered while `run` is absent.
 */
export function useSystemBack(run: (() => void) | undefined, layer: BackLayer = 'screen'): void {
  const registry = useContext(Context)
  const latest = useRef(run)
  latest.current = run
  const present = run !== undefined

  useEffect(() => {
    if (!registry || !present) return
    return registry.add(layer, () => latest.current?.())
  }, [registry, present, layer])
}

export function SystemBackProvider({
  fallback,
  children,
}: {
  /** What back does on a screen that drew no way back of its own, or null to leave the app. */
  fallback: (() => void) | null
  children: ReactNode
}) {
  const ways = useRef<Way[]>([])
  const counter = useRef(0)
  const fallbackNow = useRef(fallback)
  fallbackNow.current = fallback
  const [, redraw] = useReducer((n: number) => n + 1, 0)

  const registry = useMemo<Registry>(() => ({
    add(layer, run) {
      counter.current += 1
      const way: Way = { layer, order: counter.current, run }
      ways.current = [...ways.current, way]
      redraw()
      return () => {
        ways.current = ways.current.filter((one) => one !== way)
        redraw()
      }
    },
  }), [])

  const guard = useMemo(() => new BackGuard(
    window.history,
    () => ways.current.length > 0 || fallbackNow.current !== null,
    () => {
      const top = [...ways.current].sort((a, b) =>
        (a.layer === b.layer ? 0 : a.layer === 'over' ? 1 : -1) || a.order - b.order,
      ).pop()
      if (top) top.run()
      else fallbackNow.current?.()
    },
  ), [])

  useEffect(() => {
    const popped = () => {
      guard.popped()
      redraw()
    }
    window.addEventListener('popstate', popped)
    return () => window.removeEventListener('popstate', popped)
  }, [guard])

  // Every draw, after the screens below have registered: children's effects run before this one.
  useEffect(() => {
    guard.settle()
  })

  return <Context.Provider value={registry}>{children}</Context.Provider>
}
