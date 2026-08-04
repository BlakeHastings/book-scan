/**
 * Whether the book on screen is still the one physically in hand when
 * "back to camera" is chosen, from either the "Back to camera" button in
 * review or the Camera tab in the header nav.
 *
 * True in exactly one case: a plain capture session that never left the
 * camera and was never opened from the queue. There, "back to camera" means
 * "let me retake the blurry one", so the capture stays open.
 *
 * Everything else reached review without the book physically present: a
 * queue entry opened to check on it (`fromQueue`), or a catalogued book
 * pulled up from the library (`bookId` set). #47 and #48 argued the queue
 * case belonged with the in-hand case too, on the reasoning that the same
 * book was still in hand; that was accepted in review and turned out wrong
 * (#62): the capture stayed in hand when the person believed they had put
 * it down, and the next shot overwrote its `back_image`. So anything that
 * is not plainly in-hand must be put down before the viewfinder reopens.
 */
export function bookStillInHand(fromQueue: boolean, bookId: number | null): boolean {
  return !fromQueue && bookId === null
}
