/**
 * `UnitOfWork` over `Db.tx`, and `Clock` over the system clock.
 *
 * The open transaction is carried in `PgDb`'s async context, so a repository
 * called from inside `work` lands in it through its own `Db` handle, and a `run`
 * inside a `run` is `Db.tx`'s savepoint. The lock order is enforced in `PgDb`,
 * where every lock is taken, so it covers a plain `Db.tx` nested in a unit of
 * work as well as `serialiseOn`.
 */

import type { Clock, LockName, UnitOfWork, UnitOfWorkOptions, WorkScope } from '../../application/ports'
import type { Db } from '../../server/driver'

export class DbUnitOfWork implements UnitOfWork {
  private readonly scope: WorkScope

  constructor(private readonly db: Db) {
    this.scope = {
      // An empty savepoint, because `PgDb` takes a savepoint's locks before
      // `SAVEPOINT` and they belong to the enclosing transaction from then on.
      serialiseOn: async (name: LockName) => {
        await this.db.tx(async () => undefined, { serialiseOn: name })
      },
    }
  }

  run<T>(work: (scope: WorkScope) => Promise<T>, options?: UnitOfWorkOptions): Promise<T> {
    const locks = options?.serialiseOn
    return this.db.tx(() => work(this.scope), locks?.length ? { serialiseOn: locks } : undefined)
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}
