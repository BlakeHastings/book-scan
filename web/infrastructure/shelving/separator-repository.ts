/**
 * `SeparatorRepository` over `area` and `fixture`.
 *
 * **The port did not move and the table underneath it did.** Everything above
 * this file still asks for a boundary to be added, re-anchored or removed and
 * knows nothing about the furniture; what changed at #232 is that there is no
 * `separators` table for the answer to come out of. A boundary is the area it
 * opens, so every method here reads the range's boundaries out of the areas,
 * makes the one change it was asked for, and writes the areas back.
 *
 * That shape is not a convenience. `area.position` counts planks from the start
 * of a fixture and `starts_at` is the anchor of the boundary that opens one, so
 * inserting a boundary at the front of a run re-anchors every area after it. The
 * unit is therefore the range rather than the boundary, which is the one way
 * this was never shaped like `capture`, and it is why #213 already had to
 * re-derive a whole range on every write.
 *
 * ## Read, change, write, and the read is inside the transaction
 *
 * Each method opens its own `tx`, which nests as a savepoint inside the one the
 * caller usually already has open, and does its read inside it. Every caller
 * above is already serialised on the range (`rangeLock` in `server/shelves.ts`),
 * so this is not the thing making two overflows take turns; what it buys is that
 * the change and the areas it implies commit together or neither does.
 *
 * ## There is no `reposition` any more
 *
 * A separator carried a `position` column, and removing one meant renumbering
 * the rest or the range stopped describing the shelves. A boundary's position is
 * **derived** here: it is where the area sits in the run, so the numbering is
 * contiguous by construction and there is nothing to renumber. The port lost the
 * method rather than keeping one that could only ever be a no-op.
 *
 * ## `remove` is not shaped like the other two, and that is #465
 *
 * `add` and `reanchor` are read-change-write over this range's boundaries.
 * `remove` is not: removing a boundary takes an area off the furniture and hands
 * its books to the area in front, which is an act with a ledger row in it, and
 * writing the boundary list back without one entry is only the half of it that
 * shows on a screen. It calls `dropArea`, which is the same function
 * `DELETE /api/areas/:id` calls, so there is one writer for one act.
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
 * A boundary list with one added, in the order `areasOf` will walk it.
 *
 * The anchor decides where a boundary sits, so a new one is appended and the
 * sort is left to the write. `position` is what breaks a tie between two
 * boundaries sharing an anchor, which is what a boundary move that empties an
 * area leaves behind, and the new one goes last among them: it was recorded
 * last.
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
   * Which range a boundary is in, or undefined when it is not one.
   *
   * Asked before the transaction opens, because the lock is named after a range.
   * Every range is searched rather than the area's fixture being read, because
   * an area belongs to a range by sitting between that range's starting bookcase
   * and the next one's, which is a fact about the bands and not about the row.
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
   *
   * Where a boundary sits in the run is decided by its anchor, so writing the
   * first change on its own re-sorts the run under the second. When two
   * boundaries share an anchor, which is what a boundary move that empties an
   * area leaves behind, the second then finds its id on a different plank and
   * does nothing: the move reports carrying a book two planks and the shelves
   * carry it one. Under `separators` the two updates were independent rows and
   * both landed, so this is a thing the model made possible and has to answer
   * for.
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
   *
   * **One line, and it is the point of #465.** This used to write the boundary
   * list back without the removed entry, which is a read-modify-write of
   * `area` and nothing else: the run came out one plank shorter, the *last*
   * row of the run was the one retired, and every row between the removal and
   * the end kept its id while coming to mean a different plank. So a book
   * recorded on `2C` was left pointing at a retired row while the plank it was
   * really on had become `2B`, the shelving review named a trip for it, and
   * nobody had to carry it anywhere. `dropArea` retires the row that actually
   * went, renumbers the rest so a later plank keeps its identity, and writes
   * the `assigned` row per book that says which area took them in.
   *
   * It also refuses where the old statement quietly went ahead: an area that is
   * the only one on its piece has nothing there for its books to join, and the
   * boundary list rewrite answered that by taking every plank off the piece and
   * leaving it standing empty, which is the state #391 and #420 are about.
   *
   * The clock is read here rather than taken from the caller, because the
   * application layer has no clock and `Shelves` reads the same one a line
   * above `outstanding.record`.
   */
  async remove(id: number): Promise<BoundaryRemoved> {
    const dropped = await dropArea(this.db, id, new Date().toISOString())
    return dropped.ok ? { ok: true } : { ok: false, status: dropped.status, error: dropped.error }
  }

  /**
   * Make one change to a range's boundaries, whichever range they are in.
   *
   * The range is worked out from the id, and a boundary that has already gone
   * leaves nothing to change, which is what the store did before any of this
   * moved: removing a line somebody else has already removed has got what it
   * asked for.
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
