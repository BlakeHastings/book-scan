/**
 * The gap between somebody discarding a book and the book actually going.
 *
 * Discarding a capture deletes photographs off disk. The book has usually gone
 * back on the pile by then, so getting them back means finding it again and
 * photographing it again, which is the thing this whole project is arranged
 * not to make anybody do.
 *
 * The queue used to ask before deleting, which is a fine guard against
 * *meaning* the wrong thing and no guard at all against *doing* the wrong
 * thing: a modal that appears after every discard gets dismissed by reflex,
 * and the swipe that replaced the button (#120) is far easier to produce by
 * accident than a button was. So the order is inverted. Nothing is sent to the
 * server when the swipe lands. The discard is held here, in the browser, and
 * only when the window closes with nobody having taken it back does the delete
 * go out.
 *
 * That makes the undo real rather than a second chance: while a discard is
 * held, no request has been made and there is nothing on the server to undo.
 *
 * ## What happens if the window never closes
 *
 * The page can go away mid-window: the pane is unmounted, the tab is closed,
 * the phone drops the page because the camera app was opened. `abandon` is
 * what that path calls, and it does not delete. A capture that stays in the
 * queue costs one more swipe. A capture deleted because somebody walked away
 * costs a book off the shelf and another trip to the camera, so when the two
 * are not distinguishable this errs at the survivable one every time.
 */

/**
 * How long a discard is held before it is sent.
 *
 * Long enough to notice a row you did not mean to touch and get a thumb back
 * to it, on a screen you are only half looking at because your hands are full
 * of books. Short enough that it is over before the next book is photographed.
 */
export const UNDO_WINDOW_MS = 10_000

export interface DiscardWindow {
  /**
   * Hold this capture's discard open. Nothing is deleted yet, and nothing has
   * been sent. Holding an already-held capture leaves the original window
   * running rather than extending it.
   */
  hold(id: number): void
  /**
   * Take a discard back. Returns true when it was still held, which is to say
   * when nothing was ever sent.
   */
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
