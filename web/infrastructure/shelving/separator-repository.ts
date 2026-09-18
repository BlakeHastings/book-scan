/**
 * `SeparatorRepository` over `area` and `fixture`.
 *
 * The port did not move; the table underneath it did. Callers still ask
 * for a boundary to be added, re-anchored or removed and know nothing
 * about the furniture; there is no `separators` table for the answer to
 * come out of any more. A boundary is the area it opens, so every method
 * here reads the range's boundaries out of the areas, makes the one change
 * it was asked for, and writes the areas back.
 *
 * The unit is the range rather than the boundary: `area.position` counts
 * planks from the start of a fixture and `starts_at` is the anchor of the
 * boundary that opens one, so inserting a boundary at the front of a run
 * re-anchors every area after it.
 *
 * Each method opens its own `tx`, nested as a savepoint inside the one the
 * caller usually already has open, and reads inside it. Callers are already
 * serialised on the range (`rangeLock` in `server/shelves.ts`); what this
 * buys is that the change and the areas it implies commit together or
 * neither does.
 *
 * There is no `reposition` any more: a boundary's position is derived here,
 * as where the area sits in the run, so the numbering is contiguous by
 * construction and there is nothing to renumber.
 *
 * `remove` is not shaped like `add` and `reanchor`. Removing a boundary
 * takes an area off the furniture and hands its books to the area in
 * front, which is an act with a ledger row in it, so it calls `dropArea`,
 * the same function `DELETE /api/areas/:id` calls, rather than writing the
 * boundary list back with one entry missing.
 */

import type {
  BoundaryRemoved, NewSeparator, SeparatorRepository,
} from '../../application/shelving/ports'
import type { Separator } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'
import type { Db } from '../../server/driver'
import { boundariesOf, writeBoundaries } from './areas'
import { dropArea } from '../../server/furniture'
import { GENRE_RANGES } from '../../domain/tagging/genre'

/**
 * A boundary list with one added, in the order `areasOf` will walk it. The
 * anchor decides where a boundary sits, so a new one is appended and the
 * sort is left to the write; `position` only breaks a tie between two
 * boundaries sharing an anchor, and the new one goes last among them.
 */
function including(separators: readonly Separator[], added: NewSeparator): Separator[] {
  return [...separators, {
    id: 0,
    range: added.range,
    kind: added.kind,
    startsAt: added.startsAt,
    position: separators.length,
  }]
}

export class DrizzleSeparatorRepository implements SeparatorRepository {
  constructor(private readonly db: Db) {}

  async inRange(range: ShelfRange): Promise<Separator[]> {
    return boundariesOf(this.db, range)
  }

  /**
   * Which range a boundary is in, or undefined when it is not one. Asked
   * before the transaction opens, because the lock is named after a range.
   * Every range is searched rather than reading the area's fixture, because
   * an area belongs to a range by standing in that range's run, which is a
   * fact about the rules and not about the row: a run begins at the plank
   * its rule points at, so a plank can sit on a piece a range reaches and
   * still belong to the run before it. `undefined` for a plank no run owns
   * is the honest answer: there is no range whose boundaries a removal
   * would be rewriting.
   */
  async rangeOf(id: number): Promise<ShelfRange | undefined> {
    for (const { range } of GENRE_RANGES) {
      const found = await boundariesOf(this.db, range)
      if (found.some((one) => one.id === id)) return range
    }
    return undefined
  }

  async add(separator: NewSeparator): Promise<void> {
    await this.db.tx(async (tx) => {
      const now = await boundariesOf(tx, separator.range)
      await writeBoundaries(tx, separator.range, including(now, separator))
    })
  }

  async reanchor(id: number, startsAt: string): Promise<void> {
    await this.reanchorAll([{ id, startsAt }])
  }

  /**
   * The set in one read-modify-write, which a loop over `reanchor` is not.
   * Where a boundary sits in the run is decided by its anchor, so writing
   * the first change on its own re-sorts the run under the second. When two
   * boundaries share an anchor, the second then finds its id on a
   * different plank and does nothing: the move reports carrying a book two
   * planks and the shelves carry it one.
   */
  async reanchorAll(shifts: readonly { id: number; startsAt: string }[]): Promise<void> {
    if (!shifts.length) return
    const wanted = new Map(shifts.map((one) => [one.id, one.startsAt]))
    await this.change(shifts[0]!.id, (separators) =>
      separators.map((one) => {
        const startsAt = wanted.get(one.id)
        return startsAt === undefined ? one : { ...one, startsAt }
      }))
  }

  /**
   * Take the area this boundary opens off the furniture, books and all.
   * `dropArea` retires the row that actually went, renumbers the rest so a
   * later plank keeps its identity, and writes the `assigned` row per book
   * that says which area took them in.
   *
   * Refuses when the area is the only one on its piece: there is nothing
   * there for its books to join.
   *
   * The clock is read here rather than taken from the caller, since the
   * application layer has no clock and `Shelves` reads the same one a line
   * above `outstanding.record`.
   */
  async remove(id: number): Promise<BoundaryRemoved> {
    const dropped = await dropArea(this.db, id, new Date().toISOString())
    return dropped.ok ? { ok: true } : { ok: false, status: dropped.status, error: dropped.error }
  }

  /**
   * Make one change to a range's boundaries, whichever range they are in. A
   * boundary that has already gone leaves nothing to change: removing a
   * line somebody else already removed has got what it asked for.
   */
  private async change(
    id: number,
    edit: (separators: Separator[]) => Separator[],
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      for (const { range } of GENRE_RANGES) {
        const now = await boundariesOf(tx, range)
        if (!now.some((one) => one.id === id)) continue
        await writeBoundaries(tx, range, edit(now))
        return
      }
    })
  }
}
