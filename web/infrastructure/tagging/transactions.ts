/**
 * `BookTransactions` over `Db.tx`, and the lock namespace it uses.
 *
 * The application layer asks that two changes to one book's tags take turns.
 * What actually happens is a Postgres transaction-scoped advisory lock taken as
 * the first statement inside `BEGIN` and released by the commit or the rollback.
 * That fact belongs here and not in a command handler, which is the whole reason
 * the port exists.
 *
 * `bookLock` is exported rather than injected, unlike `DbTransactions`, and the
 * difference is only that there is nobody to inject it from: `rangeLock` lives in
 * `server/shelves.ts` beside the prose about shelf contention and importing it
 * into `infrastructure/` would have made a cycle. **If a second thing ever needs
 * to serialise on a book, it imports this name.** Two spellings of a lock name
 * are two locks, and the second one serialises against nothing.
 */

import type { BookTransactions } from '../../application/tagging/ports'
import type { Db } from '../../server/driver'

/**
 * The lock name for work on one book.
 *
 * Namespaced, because `Db` hashes the name into a 64-bit key shared with every
 * other lock in the app: a bare id would collide with a shelf range that
 * happened to hash the same way, and two unrelated things would take turns for
 * no reason anybody could find.
 */
export function bookLock(bookId: number): string {
  return `book:${bookId}`
}

export class DbBookTransactions implements BookTransactions {
  constructor(
    private readonly db: Db,
    private readonly lockName: (bookId: number) => string = bookLock,
  ) {}

  async forBook<T>(bookId: number, work: () => Promise<T>): Promise<T> {
    return this.db.tx(() => work(), { serialiseOn: this.lockName(bookId) })
  }
}
