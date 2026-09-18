import type { Capture } from './api'

/**
 * The server lists captures oldest first (`id ASC`), which is the order the background worker
 * reads them in and must not change. This reorders for display only, since books get physically
 * stacked and the one photographed most recently is what the person reaches for next.
 */
export function newestFirst(captures: Capture[]): Capture[] {
  return [...captures].sort((a, b) => b.id - a.id)
}
