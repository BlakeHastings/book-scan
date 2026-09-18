/**
 * True in exactly one case: a plain capture session that never left the camera and was never
 * opened from the queue. A queue entry opened to check on it, or a catalogued book pulled up
 * from the library, both reached review without the book physically present, so they must be
 * put down before the viewfinder reopens even though the same book may still be in hand: the
 * next shot would otherwise overwrite that capture's `back_image`.
 */
export function bookStillInHand(fromQueue: boolean, bookId: number | null): boolean {
  return !fromQueue && bookId === null
}
