/**
 * Somebody tapped Remove on a line drawn between two areas.
 *
 * The one write path converted by #172, chosen because it is the one with a
 * real invariant to protect: taking a boundary out has to leave the rest
 * numbered 0, 1, 2 ... or the range stops describing the shelves. See
 * `RangeSeparators` for what goes wrong when it does not.
 *
 * ## What a command is here
 *
 * A plain object naming what somebody asked for, and a handler that carries it
 * out. No base class, no bus, no dispatcher: there is one command, and a
 * registry for one entry is furniture rather than architecture. What the shape
 * buys immediately is that the express route can say what happened without
 * knowing how, and that this file can be read start to finish as the rule.
 */

import { RangeSeparators } from '../../domain/shelving/separators'
import type { SeparatorRepository, Transactions } from './ports'

/** Take out the boundary with this id, wherever it turns out to be. */
export interface RemoveSeparator {
  separatorId: number
}

export class RemoveSeparatorHandler {
  constructor(
    private readonly separators: SeparatorRepository,
    private readonly transactions: Transactions,
  ) {}

  /**
   * Remove a boundary and renumber the rest so positions stay contiguous.
   *
   * **Both reads matter, and they are not the same read.** The first one is
   * outside the transaction and exists only to name the range, because the lock
   * is per range and the row is the only thing that knows which one it is in.
   * The second is inside, and is the authoritative one: a boundary somebody
   * else removed in between comes back missing there and this does nothing,
   * which is what the store did before any of this moved.
   *
   * Doing the deciding read outside the transaction is exactly the defect stage
   * G had to fix here. The row supplies the position the renumbering is keyed
   * on, and two removals racing each other decremented the same tail twice, so
   * positions collided and `list`'s `ORDER BY position` returned boundaries in
   * an order the shelves did not have.
   *
   * Called from inside `Shelves.moveAcrossBoundary`'s transaction as well as on
   * its own. `Db.tx` opens a savepoint rather than a second transaction when
   * that happens, and the advisory lock is re-entrant for the same reason.
   */
  async handle(command: RemoveSeparator): Promise<void> {
    const range = await this.separators.rangeOf(command.separatorId)
    if (!range) return

    await this.transactions.inRange(range, async () => {
      const boundaries = RangeSeparators.of(range, await this.separators.inRange(range))
      const removal = boundaries.without(command.separatorId)
      if (!removal) return

      await this.separators.remove(removal.removed.id)
      for (const one of removal.renumbered) {
        await this.separators.reposition(one.id, one.position)
      }
    })
  }
}
