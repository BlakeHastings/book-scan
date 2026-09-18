/**
 * Nothing is sent to the server when the swipe lands. The discard is held here, in the
 * browser, and only when the window closes with nobody having taken it back does the
 * delete go out, so while it is held there is nothing on the server to undo.
 *
 * `abandon` is what an unmounted pane or closed tab calls instead of letting the window
 * close, and it does not delete: a capture that stays in the queue costs one more swipe,
 * while a wrongly deleted one costs a book off the shelf and another trip to the camera.
 */

/** Long enough to notice and undo a wrong swipe with hands full of books, short enough to be over before the next photograph. */
export const UNDO_WINDOW_MS = 10_000

export interface DiscardWindow {
  /** Holding an already-held capture leaves the original window running rather than extending it. */
  hold(id: number): void
  /** Returns true when it was still held, which is to say when nothing was ever sent. */
  release(id: number): boolean
  /** Every discard still being held, in the order they were made. */
  held(): number[]
  /** Let go of everything without deleting: the page is going away. */
  abandon(): void
}

/**
 * @param commit what to actually do once the window has closed on a discard,
 *   which in the pane is the delete request. Called at most once per hold, and
 *   never at all for a hold that was released or abandoned.
 * @param windowMs overridable so a test does not have to wait ten seconds.
 */
export function createDiscardWindow(
  commit: (id: number) => void,
  windowMs: number = UNDO_WINDOW_MS,
): DiscardWindow {
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  return {
    hold(id) {
      if (timers.has(id)) return
      timers.set(id, setTimeout(() => {
        timers.delete(id)
        commit(id)
      }, windowMs))
    },

    release(id) {
      const timer = timers.get(id)
      if (timer === undefined) return false
      clearTimeout(timer)
      timers.delete(id)
      return true
    },

    held() {
      return [...timers.keys()]
    },

    abandon() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
