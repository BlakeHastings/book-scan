/**
 * What the camera says about the book just put down, while the next one is
 * being photographed, and what it says about a book it has a title guess for.
 */

import { lookupOn, titleSearchOn, type Capture, type TitleSuggestion } from './api'

/** The question a cover's title search asks, or nothing where it asked none. */
export function looksLike(suggestion: TitleSuggestion | null): string {
  if (!suggestion) return ''
  const title = (suggestion.match?.title || suggestion.read.title).trim()
  return title ? `Looks like ${title}?` : ''
}

/**
 * One line about the last book. `null` is a book whose first photograph has not
 * reached the server yet, so there is no capture to ask about.
 */
export function lastBookLine(capture: Capture | null): string {
  if (!capture) return 'Last book: still sending'
  if (capture.status === 'pending') return 'Last book: still reading'

  const found = lookupOn(capture)
  if (found?.found && found.title) return `Last book: ${found.title}, found`

  const guess = looksLike(titleSearchOn(capture))
  if (guess) return `Last book: ${guess.charAt(0).toLowerCase()}${guess.slice(1)}`
  return 'Last book: no ISBN read, it is in the queue'
}

/** Whether there is nothing more to wait for, so the line can stop being asked about. */
export function lastBookSettled(capture: Capture | null): boolean {
  return capture !== null && capture.status !== 'pending'
}
