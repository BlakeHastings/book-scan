/**
 * Why a capture came out `failed`.
 *
 * `failed` is one status covering three different situations, and a person
 * standing at the shelves has to do a different thing in each. Home read the
 * status as "no ISBN" and told somebody nine books needed an ISBN typing in
 * when five of them already carried a valid one off a barcode (#148). Sending
 * a person to retype a number that is already correct is worse than saying
 * nothing, because they do it before they find out.
 *
 * There is no column recording which of the three it was, and there is not
 * going to be one: the row already carries the two facts that decide it. An
 * ISBN is there or it is not, and the worker's note says so when the read
 * itself broke. Deriving it here keeps the answer in one place instead of
 * adding a field that a future write could forget to set.
 *
 * Shared because Home counts these and the queue row names one, and those two
 * disagreeing is the whole of #148. One decision, one set of words, both
 * sides of the wire.
 */

/**
 * What is actually wrong with a capture that did not resolve.
 *
 *   noIsbn        nothing readable came off the photographs.
 *   uncatalogued  an ISBN was read and is trusted, but no catalogue has it.
 *   errored       the read itself threw before it could reach a verdict.
 *   timedOut      the reader stopped and never reached a verdict at all.
 *
 * The fourth is #299's, and it is deliberately not folded into `errored`.
 * Those two need opposite things from a person: a read that threw says
 * something went wrong with these photographs, and a read that was abandoned
 * says nothing about them at all, so the useful answer is to read them again
 * rather than to pick the book up. Sorting the second into the first would tell
 * somebody to go and handle a book whose photographs were never looked at.
 */
export type CaptureFailure = 'noIsbn' | 'uncatalogued' | 'errored' | 'timedOut'

/**
 * How a note starts when the read threw rather than finished.
 *
 * Written by the queue worker's catch and read back by `failureOf`, so the
 * two cannot drift: nothing else composes a note beginning this way.
 */
export const PROCESSING_ERROR_NOTE = 'Could not process these photos:'

/**
 * How a note starts when the reader was given up on rather than failing.
 *
 * The same arrangement as the constant above and the same reason for it: the
 * queue worker's catch is the only thing that writes a note starting this way,
 * and `failureOf` is the only thing that reads it back.
 */
export const READING_TIMEOUT_NOTE = 'Reading these photos timed out:'

/** The two columns that decide it. Both `CaptureRow` and `Capture` fit. */
export interface FailureFacts {
  isbn13: string
  note: string
}

/**
 * Which of the three a failed capture is.
 *
 * Only meaningful for a capture whose status is `failed`. A resolved one is
 * not failing at anything, so callers filter by status first rather than this
 * inventing a fourth answer for them.
 *
 * The error test comes first because a pass that threw may have stored an
 * ISBN on an earlier slot before breaking on a later one, and "it broke" is
 * the more useful thing to say about that capture than "no catalogue has it".
 */
export function failureOf(capture: FailureFacts): CaptureFailure {
  // Before the error test, for the same reason the error test comes before the
  // ISBN one: a reading that was abandoned may have stored an ISBN off an
  // earlier slot, and "it never finished" is the more useful thing to say about
  // that capture than anything derived from what it managed first.
  if (capture.note.startsWith(READING_TIMEOUT_NOTE)) return 'timedOut'
  if (capture.note.startsWith(PROCESSING_ERROR_NOTE)) return 'errored'
  return capture.isbn13 ? 'uncatalogued' : 'noIsbn'
}

/**
 * The failures a second reading could plausibly fix.
 *
 * Nothing about the photographs is wrong in either case: the reader stopped, or
 * it broke on the way to a verdict. The other two are a person's job and a
 * re-read would produce the very same answer, so offering one there would be
 * offering a button that does nothing.
 */
export const REREADABLE: readonly CaptureFailure[] = ['timedOut', 'errored']

/** Whether reading this capture's photographs again is worth offering. */
export function couldBeReadAgain(
  capture: FailureFacts & { status: string },
): boolean {
  return capture.status === 'failed' && REREADABLE.includes(failureOf(capture))
}

export type FailureCounts = Record<CaptureFailure, number>

export const noFailures: FailureCounts = {
  noIsbn: 0, uncatalogued: 0, errored: 0, timedOut: 0,
}

/** The three totals, from the failed captures themselves. */
export function countFailures(failed: FailureFacts[]): FailureCounts {
  const counts: FailureCounts = { ...noFailures }
  for (const capture of failed) counts[failureOf(capture)] += 1
  return counts
}

/**
 * What one such capture needs, short enough to sit on a queue row beside the
 * book's title. The row prints the worker's note underneath, which says which
 * photograph and which digits; this is the headline.
 */
export const FAILURE_LABEL: Record<CaptureFailure, string> = {
  noIsbn: 'needs an ISBN',
  uncatalogued: 'no catalogue has its ISBN',
  errored: 'could not be read',
  // Not "could not be read", which is what `errored` says and would be a lie
  // here: nothing read these photographs, so nothing found them wanting.
  timedOut: 'reading it took too long',
}

/**
 * The same three counted, as sentences for Home.
 *
 * Each one names the action rather than the state, because Home is where the
 * work gets sorted before anybody picks a book up. Zero of something is left
 * out entirely: a queue with nothing wrong in that way should not spend a line
 * of a phone screen saying so.
 */
export function failureLines(counts: FailureCounts): string[] {
  const lines: string[] = []
  if (counts.noIsbn) {
    lines.push(`${counts.noIsbn} need an ISBN by hand.`)
  }
  if (counts.uncatalogued) {
    lines.push(
      `${counts.uncatalogued} need details by hand. No catalogue has their ISBN.`,
    )
  }
  if (counts.errored) {
    lines.push(`${counts.errored} hit an error while being read.`)
  }
  if (counts.timedOut) {
    // Says what to do rather than what happened, like the three above it, and
    // the thing to do is not to pick the book up. Nobody read these
    // photographs, so nothing is known to be wrong with them.
    lines.push(
      `${counts.timedOut} timed out while being read. `
      + 'Nothing is wrong with the photographs; read them again.',
    )
  }
  return lines
}
