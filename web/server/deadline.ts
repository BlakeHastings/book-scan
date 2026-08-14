/**
 * Giving up on work that has not come back.
 *
 * Its own file, small as it is, for two reasons.
 *
 * The first is that `ReadingTimedOut` has to be reachable without reaching
 * `server/identify.ts`. The queue tells an abandoned reading apart from a
 * broken one with `instanceof`, and several test files replace the whole of
 * `./identify` with a stub; a class exported from there would be `undefined` in
 * those files and the check would throw inside the very catch that exists to
 * cope with a throw.
 *
 * The second is that a deadline is not an OCR idea. It is what #299 turned out
 * to be about: nothing in this server bounded any part of reading a photograph,
 * so one call that never returned held a process-wide chain and every scan
 * behind it, for the life of the process, with nothing said.
 */

/**
 * A reading that was abandoned rather than one that failed.
 *
 * Its own type because the two mean different things to a person: a read that
 * threw says something about the photograph, and this says the reader stopped
 * and the photograph was never given a verdict. `CaptureQueue.process` writes a
 * different note for each, and `shared/captureFailure.ts` turns those into the
 * two different things the queue tells somebody to do.
 */
export class ReadingTimedOut extends Error {
  constructor(what: string, public readonly ms: number) {
    super(`${what} did not finish within ${Math.round(ms / 1000)} seconds.`)
    this.name = 'ReadingTimedOut'
  }
}

/**
 * Give up on a promise that has not settled in time.
 *
 * `onExpiry` is how a caller reclaims whatever the abandoned work is still
 * holding, since nothing here can stop it: WASM has no cancel, so the only
 * levers are to stop waiting and, where there is one, to throw the worker away.
 *
 * Two details that are load bearing rather than tidy. The rejection handler is
 * attached whatever happens, so work that was abandoned and fails later cannot
 * become an ownerless rejection, which under this repository's rules would be
 * a line nobody reads at best (`AGENTS.md`, on `inTheBackground`). And the
 * timer is unrefed, so a bound that is merely generous never holds the process
 * open past the work it was watching.
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  what: string,
  onExpiry?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onExpiry?.()
      reject(new ReadingTimedOut(what, ms))
    }, ms)
    timer.unref?.()
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}
