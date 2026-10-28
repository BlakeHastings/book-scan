/**
 * The names work serialises on, and the one order they are taken in.
 *
 * A name is the thing being read and then written, not the statement: two books
 * being filed into fiction contend, a book going into fiction and one going into
 * non-fiction do not. Two spellings of one name are two locks, and the second
 * serialises against nothing, so every name is built here and nowhere else.
 */

import { resolveIsbnPair } from '../shared/isbn'
import type { ShelfRange } from '../shared/shelving'

/** A lock name built by one of the functions below, and only by them. */
export type LockName = string & { readonly lockName: unique symbol }

/**
 * Work on one book. Namespaced because every name hashes into one 64-bit key
 * space: a bare id could collide with a range and two unrelated things would
 * take turns for no reason anybody could find.
 */
export const bookLock = (bookId: number): LockName => `book:${bookId}` as LockName

/**
 * Asking whether a book with this ISBN is catalogued and then cataloguing one.
 * Built from the resolved thirteen digit form, so the ten and thirteen digit
 * spellings of one book are one lock; null for a value that is no ISBN, which
 * has nothing to contend on.
 */
export const isbnLock = (isbn: string): LockName | null => {
  const { isbn13 } = resolveIsbnPair(isbn)
  return isbn13 ? `isbn:${isbn13}` as LockName : null
}

/** Reading a shelf range and then writing to it. */
export const rangeLock = (range: ShelfRange): LockName => `shelf:${range}` as LockName

/** Rearranging the room: fixtures, areas and rules. */
export const FURNITURE_LOCK = 'furniture' as LockName

/**
 * What a write to a range's boundaries serialises on. A boundary is the area it
 * opens, so moving one rewrites the furniture, and the plan it writes from is
 * read off the furniture too: both locks are held from the first read.
 */
export const boundaryLocks = (range: ShelfRange): readonly LockName[] =>
  [rangeLock(range), FURNITURE_LOCK]

/**
 * Which lock is taken before which, by the namespace a name starts with and then
 * by its spelling: any `isbn:`, any `book:`, then `shelf:fiction`,
 * `shelf:nonfiction`, then `furniture`.
 *
 * An ISBN comes first because a new book has no id to lock until its row is
 * written, so the number is the only thing two saves of it can meet on, and it
 * is known before anything is read: a save out of the queue names it beside
 * the scan's `book:` at the start. A book comes before a range because a unit
 * of work on a book only learns its range once the genre is settled, and the
 * furniture comes last because nothing that holds it takes either of the others.
 */
const LOCK_ORDER = ['isbn:', 'book:', 'shelf:', 'furniture'] as const

function rank(name: string): number {
  const at = LOCK_ORDER.findIndex((prefix) => name.startsWith(prefix))
  if (at === -1) {
    throw new Error(`${name} has no place in LOCK_ORDER, so it cannot be taken beside another lock`)
  }
  return at
}

/** Negative when `a` is taken before `b`. Throws for a name in no namespace. */
export function compareLocks(a: string, b: string): number {
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * The names asked for, once each, in the order they are taken. A single name is
 * taken as is, whatever it is; a name in no namespace beside another is refused
 * rather than guessed a place, because where it goes is a decision about every
 * other lock.
 */
export function inLockOrder(names: string | readonly string[]): string[] {
  const wanted = [...new Set(typeof names === 'string' ? [names] : names)]
  if (wanted.length < 2) return wanted
  return wanted.sort(compareLocks)
}

/**
 * Why `next` may not be taken by work that already holds `held`, or undefined
 * when it may. Taking a name already held is always allowed: Postgres counts a
 * re-entrant advisory lock rather than blocking on it.
 */
export function outOfOrder(held: Iterable<string>, next: string): string | undefined {
  for (const name of held) {
    if (name === next) return undefined
  }
  for (const name of held) {
    if (compareLocks(next, name) < 0) {
      return `${next} cannot be taken while holding ${name}: the order is isbn, book, shelf, furniture`
    }
  }
  return undefined
}
