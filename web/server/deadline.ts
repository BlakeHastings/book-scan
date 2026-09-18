/**
 * Giving up on work that has not come back.
 *
 * `ReadingTimedOut` has its own file so it is reachable without reaching
 * `server/identify.ts`: several test files replace the whole of `./identify`
 * with a stub, and a class exported from there would then be `undefined`,
 * making the `instanceof` check that tells an abandoned reading from a
 * broken one throw inside the very catch meant to handle it.
 *
 * A deadline is not an OCR idea: nothing elsewhere in this server bounds any
 * part of reading a photograph, so one call that never returns can hold a
 * process-wide chain, and every scan behind it, for the life of the process.
 */

/**
 * A reading that was abandoned rather than one that failed: a throw says
 * something about the photograph, this says the reader stopped and the
 * photograph was never given a verdict. `CaptureQueue.process` writes a
 * different note for each.
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
 * holding, since nothing here can stop it: WASM has no cancel.
 *
 * Two details are load bearing rather than tidy: the rejection handler is
 * attached whatever happens, so work that fails after being abandoned cannot
 * become an unhandled rejection; and the timer is unrefed, so a generous
 * bound never holds the process open past the work it was watching.
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
