/**
 * The phone's back gesture, kept inside the app while the app has a way back.
 *
 * The route lives in memory and never in the URL, so the browser has one
 * entry for the whole app and the gesture would otherwise leave it. While
 * anything on screen has a way back, one extra entry, the guard, sits on top
 * of the app's own. Going back pops it, and the app answers by doing what its
 * own back arrow would; if there is still a way back afterwards, the guard is
 * put back. When there is none, on the first screen with nothing open, the
 * guard is taken away, so the gesture leaves the app the way it always did.
 *
 * There is never more than one guard. A push happens only from an entry that
 * is not one, and `pushState` throws away whatever was ahead, so going forward
 * after a back lands on nothing, or on a guard nobody wants, which is put away
 * again at once.
 */

/** The parts of `window.history` this needs, so a test can hand it a fake. */
export interface HistoryLike {
  readonly state: unknown
  pushState(data: unknown, unused: string): void
  back(): void
}

const MARK = 'bookscanBack'

/** Whether a history entry is the guard. It survives a reload, since the browser keeps an entry's state. */
export function isGuard(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARK] === true
}

export class BackGuard {
  /** Pops this guard caused itself, which are not somebody pressing back. */
  private ours = 0

  constructor(
    private readonly history: HistoryLike,
    /** Whether anything on screen has a way back right now. */
    private readonly wanted: () => boolean,
    /** Do what the on-screen way back does. */
    private readonly goBack: () => void,
  ) {}

  /** Put the guard up or take it away, to match whether there is a way back. Safe to call any number of times. */
  settle(): void {
    const up = isGuard(this.history.state)
    const want = this.wanted()
    if (want && !up) {
      this.history.pushState({ [MARK]: true }, '')
    } else if (!want && up) {
      this.ours += 1
      this.history.back()
    }
  }

  /**
   * The browser moved between entries. Call `settle` once the app has drawn
   * whatever this led to, since the way back it leaves behind is only known
   * then.
   */
  popped(): void {
    if (this.ours > 0) {
      this.ours -= 1
      return
    }
    // Arriving on a guard is going forward, which asks nothing of the app.
    if (isGuard(this.history.state)) return
    if (this.wanted()) this.goBack()
  }
}
