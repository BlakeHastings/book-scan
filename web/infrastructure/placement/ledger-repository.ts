/**
 * The placement ledger against Postgres, and the projection that goes with it.
 *
 * `record` writes two things in one transaction: the row into
 * `book_placement`, and `books.current_area_id` folded from that book's
 * rows immediately afterwards. There is no window in which the ledger says
 * one thing and the column says another, and no caller that can forget the
 * second statement, because there is no second call to make.
 *
 * The projection is written by folding the rows back out of the table
 * rather than by assuming the row just inserted is the answer: an
 * assignment says where the rules want a book and moves nothing, so a
 * projection written from the row would put every book where it has not
 * been carried. Folding also makes this statement the same one `0015` and
 * `rebuildProjection` use, so there is one definition of the fold in SQL
 * and one in `domain/placement/ledger.ts`, which a test compares.
 */

import { inArray } from 'drizzle-orm'
import {
  KINDS_ABOUT_THE_ANSWER,
  type Placement, type PlacementActor, type PlacementKind,
} from '../../domain/placement/ledger'
import type { NewPlacement, PlacementLedger } from '../../application/placement/ports'
import type { Db } from '../../server/driver'
import { bookPlacement } from '../db/schema'
import { build, statement } from '../db/query'

/** Column names, not domain names: this is what the statement hands back. */
interface PlacementRow {
  id: number
  book_id: number
  kind: PlacementKind
  area_id: number | null
  sort_key: string
  rule_id: number | null
  actor: PlacementActor
  reason: string
  created_at: string
}

function toPlacement(row: PlacementRow): Placement {
  return {
    id: Number(row.id),
    bookId: Number(row.book_id),
    kind: row.kind,
    areaId: row.area_id === null ? null : Number(row.area_id),
    sortKey: row.sort_key,
    ruleId: row.rule_id === null ? null : Number(row.rule_id),
    actor: row.actor,
    reason: row.reason,
    createdAt: row.created_at,
  }
}

export class DrizzlePlacementLedger implements PlacementLedger {
  constructor(private readonly db: Db) {}

  async record(placement: NewPlacement): Promise<void> {
    await this.db.tx(async (tx) => {
      const insert = statement(build.insert(bookPlacement).values({
        bookId: placement.bookId,
        kind: placement.kind,
        areaId: placement.areaId,
        sortKey: placement.sortKey,
        ruleId: placement.ruleId ?? null,
        actor: placement.actor,
        reason: placement.reason ?? '',
        createdAt: placement.createdAt,
      }))
      await tx.run(insert.text, insert.values)

      // The projection, folded out of the rows this book now has: one
      // book, so this is an index seek down `idx_book_placement_book`
      // rather than the catalogue-wide statement `rebuildProjection` makes.
      //
      // Written even for an `assigned` or `released` row, deliberately:
      // the fold's answer is unchanged, and a branch here would be a
      // second place that has to know which kinds move a book.
      await tx.run(
        `UPDATE books SET current_area_id = (
           SELECT CASE WHEN p.kind IN ('placed', 'pinned') THEN p.area_id END
             FROM book_placement p
            WHERE p.book_id = ? AND p.kind NOT IN (${
  KINDS_ABOUT_THE_ANSWER.map((kind) => `'${kind}'`).join(', ')})
            ORDER BY p.id DESC LIMIT 1
         )
         WHERE id = ?`,
        [placement.bookId, placement.bookId],
      )
    })
  }

  async forBooks(bookIds: readonly number[]): Promise<Placement[]> {
    if (!bookIds.length) return []

    const query = statement(
      build.select().from(bookPlacement)
        .where(inArray(bookPlacement.bookId, [...bookIds]))
        .orderBy(bookPlacement.bookId, bookPlacement.id),
    )
    const rows = await this.db.all<PlacementRow>(query.text, query.values)
    return rows.map(toPlacement)
  }
}

/**
 * The area a recorded location label names, or null when the furniture has
 * no such plank. This is the one place a label is turned back into a row,
 * and it exists because `books.location` is still authoritative: it holds
 * `1A`, derived at read time from a fixture's position and an area's, so
 * the mapping has to be walked backwards. Null is a real answer: a person
 * may record `9Z` via `PATCH /api/books/:id/location`, and `0015` counts
 * those rather than inventing furniture to hold them.
 *
 * A named piece answers to its number too: naming a piece changes what it
 * reads as and changes nothing about where it stands, since a position is
 * an address rather than a rendering. The layout goes on calling that
 * plank `1A`, because `locationLabel` is built from ordinals.
 *
 * Lowest id first where two pieces stand at one position, which is the
 * rule `fixturesIn` and `runAreasOf` already read a band by: the piece
 * that was there first is the one this range's own furniture is in.
 */
export async function areaForLabel(
  db: Db,
  fixturePosition: number,
  areaPosition: number,
): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    `SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE f.position = ? AND a.position = ?
      ORDER BY f.id, a.id LIMIT 1`,
    [fixturePosition, areaPosition],
  )
  return row ? Number(row.id) : null
}
