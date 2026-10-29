import type { Capture } from './api'

/** One line of the queue list: a capture on its own, or several scans of one book. */
export type QueueEntry =
  | { kind: 'one'; capture: Capture }
  | { kind: 'same'; isbn13: string; captures: Capture[] }

/**
 * The captures in the order given, with every capture that shares an ISBN
 * gathered where the first of them stands. A capture with no ISBN is never
 * grouped: two books nobody could read a number off do not share one. A shelved
 * capture is not grouped either, since it is no longer a scan to choose between.
 */
export function groupByIsbn(captures: Capture[]): QueueEntry[] {
  const byIsbn = new Map<string, Capture[]>()
  for (const capture of captures) {
    const isbn = groupKey(capture)
    if (!isbn) continue
    const same = byIsbn.get(isbn)
    if (same) same.push(capture)
    else byIsbn.set(isbn, [capture])
  }

  const entries: QueueEntry[] = []
  const placed = new Set<string>()
  for (const capture of captures) {
    const isbn = groupKey(capture)
    const same = isbn ? byIsbn.get(isbn)! : []
    if (same.length < 2) {
      entries.push({ kind: 'one', capture })
      continue
    }
    if (placed.has(isbn)) continue
    placed.add(isbn)
    entries.push({ kind: 'same', isbn13: isbn, captures: same })
  }
  return entries
}

function groupKey(capture: Capture): string {
  if (capture.status === 'done') return ''
  return capture.isbn13.trim()
}

/** Every other scan in the group, which is what keeping `kept` discards. */
export function othersThan(kept: Capture, group: Capture[]): Capture[] {
  return group.filter((capture) => capture.id !== kept.id)
}

/** What a group of `n` scans of one book says above them. */
export function sameBookSaid(n: number): string {
  const others = n - 1
  return `${n} scans of this book. Keep one and the `
    + (others === 1 ? 'other is discarded.' : `other ${others} are discarded.`)
}
