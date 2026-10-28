/**
 * `PlacementOnSave` over `Db`: the neighbours a saved book sits between, and the
 * ledger row its save appends.
 *
 * The ledger row goes through `server/placement-ledger.ts`, which writes
 * `book_placement` and the `current_area_id` projection together, on whatever
 * transaction the `Db` is in, so the save's unit of work commits the book and
 * where it went at once.
 */

import type { PlacementOnSave, ShelvedOn } from '../../application/books/ports'
import type { Db } from '../../server/driver'
import { recordPlaced, recordPlacedIn } from '../../server/placement-ledger'
import { recordWhereItNowBelongs } from '../../server/what-moved'
import { locationLabel } from '../../shared/layout'
import { buildPlacement, type Placement, type ShelfRange } from '../../shared/shelving'
import { bandOf } from '../shelving/areas'
import { DrizzleShelfReads } from './shelf-reads'

/** The plank a shelved book stands on in its run's layout, or null when it has none. */
export type AreaOf = (range: ShelfRange, bookId: number) => Promise<number | null>

export class DrizzlePlacementOnSave implements PlacementOnSave {
  private readonly shelf: DrizzleShelfReads

  constructor(private readonly db: Db, private readonly areaOf: AreaOf) {
    this.shelf = new DrizzleShelfReads(db)
  }

  async whereItGoes(range: ShelfRange, sortKey: string, bookId: number): Promise<Placement> {
    const { predecessor, successor } = await this.shelf.neighbours(range, sortKey, bookId)
    // Null when no rule says where the range begins: nothing here invents a plank.
    const band = await bandOf(this.db, range)
    return buildPlacement(range, predecessor, successor,
      band ? locationLabel(band.start.shelf, band.start.area) : null)
  }

  async recordSave(
    book: { id: number; sortKey: string; range: ShelfRange | null },
    shelvedOn: ShelvedOn,
    at: string,
  ): Promise<void> {
    if (shelvedOn !== 'where-it-lands') {
      await recordPlaced(this.db, { id: book.id, sortKey: book.sortKey, location: shelvedOn.label }, at)
      return
    }
    if (book.range === null) return
    const landed = await this.areaOf(book.range, book.id)
    if (landed !== null) await recordPlacedIn(this.db, { id: book.id, sortKey: book.sortKey, location: '' }, landed, at)
  }

  async recordWhereItNowBelongs(
    bookId: number,
    was: { range: ShelfRange | null; sortKey: string },
    now: { range: ShelfRange | null; sortKey: string },
    at: string,
  ): Promise<void> {
    await recordWhereItNowBelongs(this.db, bookId, was, now, 'an edit changed where it files', at)
  }
}
