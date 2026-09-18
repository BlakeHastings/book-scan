/**
 * Removes a boundary between two areas.
 *
 * After removal the rest must stay numbered 0, 1, 2, ... or the range stops
 * describing the shelves. See `RangeSeparators`.
 */

import { RangeSeparators } from '../../domain/shelving/separators'
import type { ShelfRange } from '../../shared/shelving'
import type { SeparatorRepository, Transactions } from './ports'

/** Take out the boundary with this id, wherever it turns out to be. */
export interface RemoveSeparator {
  separatorId: number
  /**
   * Whether the area's removal has been confirmed. Absent means not asked,
   * treated as not confirmed. See `handle`.
   */
  theAreaGoes?: boolean
}

/**
 * `removed: null` means the boundary was already gone; still `ok`, since a
 * retry must not become an error.
 */
export type SeparatorRemoval =
  | { ok: true; removed: number | null }
  | { ok: false; reason: 'not-assented'; areaId: number; range: ShelfRange }
  /** The one case today: the area is the only one on its piece, so its books have nowhere to join. */
  | { ok: false; reason: 'refused'; status: number; error: string }

export class RemoveSeparatorHandler {
  constructor(
    private readonly separators: SeparatorRepository,
    private readonly transactions: Transactions,
  ) {}

  /**
   * Remove a boundary, if this range still has one with that id.
   *
   * The first read is outside the transaction, only to find which range to
   * lock; the second, inside the transaction, is authoritative. A boundary
   * removed by someone else in between comes back missing there and this call
   * is a no-op.
   *
   * Reentrant: called both on its own and from inside
   * `Shelves.moveAcrossBoundary`'s transaction, where `Db.tx` opens a savepoint
   * and the advisory lock allows re-entry.
   */
  async handle(command: RemoveSeparator): Promise<SeparatorRemoval> {
    const range = await this.separators.rangeOf(command.separatorId)
    if (!range) return { ok: true, removed: null }

    return this.transactions.inRange(range, async (): Promise<SeparatorRemoval> => {
      const boundaries = RangeSeparators.of(range, await this.separators.inRange(range))
      const removal = boundaries.without(command.separatorId)
      if (!removal) return { ok: true, removed: null }

      // Checked before the write, so an unconfirmed caller gets a refusal and nothing changed.
      if (command.theAreaGoes !== true) {
        return { ok: false, reason: 'not-assented', areaId: removal.id, range }
      }

      // `remove` takes the area off the furniture, reassigns its books and
      // records that in one write; this handler only decides whether to call it.
      const taken = await this.separators.remove(removal.id)
      if (!taken.ok) {
        return { ok: false, reason: 'refused', status: taken.status, error: taken.error }
      }
      return { ok: true, removed: removal.id }
    })
  }
}
