/**
 * `Transactions` over `Db.tx`.
 *
 * Nine lines, and every one of them is why the port exists. The application
 * layer asks for two changes to one range to take turns; what actually happens
 * is a Postgres transaction-scoped advisory lock taken as the first statement
 * inside `BEGIN` and released by the commit or the rollback, or, on SQLite, a
 * single connection held from `BEGIN` to `COMMIT`, which is strictly stronger
 * and needs no lock at all. Neither of those facts is one a command handler
 * should have to hold.
 *
 * The lock name is injected rather than imported. `rangeLock` lives in
 * `web/server/shelves.ts` beside the prose explaining the namespace, and
 * importing it here would make this file and that one a cycle. Spelling the
 * name a second time instead was the other option, and two spellings of a lock
 * name is two locks: the second one serialises against nothing.
 */

import type { Transactions } from '../../application/shelving/ports'
import type { ShelfRange } from '../../shared/shelving'
import type { Db } from '../../server/driver'

export class DbTransactions implements Transactions {
  constructor(
    private readonly db: Db,
    private readonly lockName: (range: ShelfRange) => string,
  ) {}

  async inRange<T>(range: ShelfRange, work: () => Promise<T>): Promise<T> {
    return this.db.tx(() => work(), { serialiseOn: this.lockName(range) })
  }
}
