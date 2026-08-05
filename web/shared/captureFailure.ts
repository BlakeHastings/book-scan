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
 */
export type CaptureFailure = 'noIsbn' | 'uncatalogued' | 'errored'

/**
 * How a note starts when the read threw rather than finished.
 *
 * Written by the queue worker's catch and read back by `failureOf`, so the
 * two cannot drift: nothing else composes a note beginning this way.
 */
export const PROCESSING_ERROR_NOTE = 'Could not process these photos:'

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
  if (capture.note.startsWith(PROCESSING_ERROR_NOTE)) return 'errored'
  return capture.isbn13 ? 'uncatalogued' : 'noIsbn'
}

export type FailureCounts = Record<CaptureFailure, number>

export const noFailures: FailureCounts = { noIsbn: 0, uncatalogued: 0, errored: 0 }

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
  return lines
}
