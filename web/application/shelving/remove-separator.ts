/**
 * Somebody tapped Remove on a line drawn between two areas.
 *
 * The one write path converted by #172, chosen because it is the one with a
 * real invariant to protect: taking a boundary out has to leave the rest
 * numbered 0, 1, 2 ... or the range stops describing the shelves. See
 * `RangeSeparators` for what goes wrong when it does not.
 *
 * **The renumbering is no longer this handler's to do (#232).** A boundary is
 * the `area` it opens and its position is where that area sits in the run, so
 * the numbering is contiguous by construction. `RangeSeparators.without` still
 * says which boundary is going and still refuses an id this range does not have,
 * which is the part of the rule that was ever about a decision.
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
import type { ShelfRange } from '../../shared/shelving'
import type { SeparatorRepository, Transactions } from './ports'

/** Take out the boundary with this id, wherever it turns out to be. */
export interface RemoveSeparator {
  separatorId: number
  /**
   * Somebody has been told the area comes off the furniture and said yes.
   *
   * Absent means nobody has been asked, which is the only safe reading of a
   * caller that does not mention it (#456). See `handle`.
   */
  theAreaGoes?: boolean
}

/**
 * What became of a removal, which is three answers rather than two.
 *
 * `removed: null` is the boundary that was already gone. It is an `ok` because
 * the caller has what it asked for, and the difference between that and a
 * refusal is the whole reason this is a union rather than a boolean: a retry
 * must not become an error.
 */
export type SeparatorRemoval =
  | { ok: true; removed: number | null }
  | { ok: false; areaId: number; range: ShelfRange }

export class RemoveSeparatorHandler {
  constructor(
    private readonly separators: SeparatorRepository,
    private readonly transactions: Transactions,
  ) {}

  /**
   * Remove a boundary, if this range still has one with that id.
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
   *
   * ## It refuses a removal nobody has agreed to (#456)
   *
   * Removing a boundary takes an area off the furniture and hands its books to
   * the area before it, and #281 settled that a thing somebody cannot find out
   * afterwards is asked about first. The rule is here rather than on either
   * caller because it is the act, and this handler had two callers of which
   * only one had ever been guarded: `Shelves.moveAcrossBoundary` refused
   * without `theAreaGoes` (#433) and `DELETE /api/shelves/:id` had no such
   * parameter at all, so one tap on a divider removed an area and relocated
   * its books with nothing said. A caller cannot forget what it never had to
   * remember, which is the same reason the placement ledger sits on the
   * statements that write a location (#185) and not on the routes above them.
   *
   * **The order of the two checks is the rule about retries.** A boundary this
   * range no longer has is answered `{ ok: true, removed: null }`, not refused:
   * a request to remove a line somebody else already removed has got what it
   * asked for, and turning that into a refusal would make a second tap on a
   * stale screen an error. Only a boundary that is really there and really
   * about to go is refused.
   */
  async handle(command: RemoveSeparator): Promise<SeparatorRemoval> {
    const range = await this.separators.rangeOf(command.separatorId)
    if (!range) return { ok: true, removed: null }

    return this.transactions.inRange(range, async (): Promise<SeparatorRemoval> => {
      const boundaries = RangeSeparators.of(range, await this.separators.inRange(range))
      const removal = boundaries.without(command.separatorId)
      if (!removal) return { ok: true, removed: null }

      // Before the write and not after it, so a caller that has not asked gets
      // the refusal and a room exactly as it was.
      if (command.theAreaGoes !== true) return { ok: false, areaId: removal.id, range }

      await this.separators.remove(removal.id)
      return { ok: true, removed: removal.id }
    })
  }
}
