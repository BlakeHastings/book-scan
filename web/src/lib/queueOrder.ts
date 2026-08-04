import type { Capture } from './api'

/**
 * Order captures for display: newest scan first.
 *
 * Books get physically stacked on top of one another, so the one
 * photographed most recently sits on top of the pile and is what the person
 * reaches for next. The server lists captures oldest first (`id ASC`)
 * because that is the order the background worker reads them in, which must
 * not change. This is display only: it does not touch what is stored or
 * which capture the worker claims next.
 */
export function newestFirst(captures: Capture[]): Capture[] {
  return [...captures].sort((a, b) => b.id - a.id)
}
