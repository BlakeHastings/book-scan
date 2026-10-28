/**
 * The ports every context shares: running work as one unit, and the time.
 */

import type { LockName } from './locks'

export type { LockName } from './locks'

/**
 * What work running in a unit of work can ask of it.
 */
export interface WorkScope {
  /**
   * Hold this lock from now until the unit of work commits or rolls back, for
   * work that only learns what it contends on part of the way through: a save
   * knows its range only once the genre is settled.
   *
   * Refused, with an error, when it would take a lock out of order (see
   * `LOCK_ORDER` in `./locks`), because the alternative is a deadlock later
   * against somebody who took the same two the right way round.
   */
  serialiseOn(name: LockName): Promise<void>
}

export interface UnitOfWorkOptions {
  /** Held from before the first read. Taken in lock order, whatever order given. */
  serialiseOn?: readonly LockName[]
}

/**
 * Atomicity, and mutual exclusion where it is asked for, which are two things
 * rather than one: a unit of work commits or rolls back whole, and does not stop
 * another one committing a row in the middle of it unless both name a lock.
 *
 * Every repository called while `work` runs takes part, without being handed
 * anything. A `run` inside another joins it: its writes commit or roll back with
 * the outer one, and a throw out of it that the outer work catches undoes only
 * the inner writes. Locks it took stay held until the outer one ends.
 */
export interface UnitOfWork {
  run<T>(work: (scope: WorkScope) => Promise<T>, options?: UnitOfWorkOptions): Promise<T>
}

export interface Clock {
  now(): Date
}
