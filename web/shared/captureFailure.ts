/**
 * What is actually wrong with a capture that did not resolve.
 *
 * - `noIsbn`: nothing readable came off the photographs.
 * - `uncatalogued`: an ISBN was read and trusted, but no catalogue has it.
 * - `errored`: the read threw before reaching a verdict.
 * - `timedOut`: the read was abandoned before reaching a verdict.
 *
 * Not derived from a stored column: the row already carries the two facts
 * (`isbn13` and `note`) that decide it.
 */
export type CaptureFailure = 'noIsbn' | 'uncatalogued' | 'errored' | 'timedOut'

/** Prefix marking a note as a processing error; written by the queue worker, read back by `failureOf`. */
export const PROCESSING_ERROR_NOTE = 'Could not process these photos:'

/** Prefix marking a note as a timeout; written by the queue worker, read back by `failureOf`. */
export const READING_TIMEOUT_NOTE = 'Reading these photos timed out:'

/** The two columns that decide it. Both `CaptureRow` and `Capture` fit. */
export interface FailureFacts {
  isbn13: string
  note: string
}

/**
 * Only meaningful when status is `failed`; callers filter by status first.
 *
 * Timeout and error checks come before the ISBN check: a capture that timed
 * out or threw may still have stored an ISBN from an earlier slot, and that
 * should not override the more urgent verdict.
 */
export function failureOf(capture: FailureFacts): CaptureFailure {
  if (capture.note.startsWith(READING_TIMEOUT_NOTE)) return 'timedOut'
  if (capture.note.startsWith(PROCESSING_ERROR_NOTE)) return 'errored'
  return capture.isbn13 ? 'uncatalogued' : 'noIsbn'
}

/** Only these two: the other two are a person's job, since a re-read would produce the same answer. */
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

/** Short label for a queue row, printed beside the book's title; the worker's note beneath gives detail. */
export const FAILURE_LABEL: Record<CaptureFailure, string> = {
  noIsbn: 'needs an ISBN',
  uncatalogued: 'no catalogue has its ISBN',
  errored: 'could not be read',
  // Not "could not be read": nothing read these photographs, so nothing found them wanting.
  timedOut: 'reading it took too long',
}
