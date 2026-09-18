/**
 * What a write that changes the run costs somebody, written to the ledger.
 *
 * One function, since it is one act: an `assigned` row per book whose plank
 * the write changed, decided by comparing the run's answer before against its
 * answer after. A boundary move is one write that does this; renumbering a
 * piece of furniture is another, since it can reorder or drop planks from the
 * run.
 */

import { assignmentFor, standingOf, type Placement } from '../domain/placement/ledger'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { areaOfKey, runAreasOf } from '../infrastructure/shelving/areas'
import type { ShelfRange } from '../shared/shelving'
import type { Db } from './driver'

/** Where the run puts one book, as the row rather than as the label. */
export interface RunAnswer {
  sortKey: string
  area: number | null
}

/**
 * The area of this range each of these sort keys lands in.
 *
 * The same walk `shelvesForSortKeys` makes, answered as the row rather than
 * the label, so this and the boundary review read one sequence instead of two
 * that have to agree.
 *
 * Null for every key when the range has no run at all: a rule pointing at
 * furniture that has been taken out.
 */
export async function areasForSortKeys(
  db: Db,
  range: ShelfRange,
  sortKeys: readonly string[],
): Promise<(number | null)[]> {
  if (!sortKeys.length) return []
  const run = await runAreasOf(db, range)
  return sortKeys.map((sortKey) => areaOfKey(run, sortKey)?.id ?? null)
}

/**
 * Which plank the run puts every shelved book of a range on, right now.
 *
 * The same walk `review` compares against and `areasForSortKeys` answers,
 * read as plank ids rather than as labels: a before-and-after taken in
 * labels would report a book as moved when only the letter under it changed,
 * and would miss one that moved onto a plank whose letter it already had.
 *
 * Lean deliberately: `layout` joins photographs and placements onto every
 * row because it draws a shelf, while this only decides which books to write
 * a row for, and it is taken twice per write.
 */
export async function whereTheRunPutsThem(
  db: Db,
  range: ShelfRange,
): Promise<Map<number, RunAnswer>> {
  const rows = await db.all<{ id: number; sort_key: string }>(
    `SELECT id, sort_key FROM shelved_books WHERE shelf_range = ? ORDER BY sort_key ASC`,
    [range],
  )
  const areas = await areasForSortKeys(db, range, rows.map((row) => row.sort_key))
  return new Map(rows.map((row, at) =>
    [Number(row.id), { sortKey: row.sort_key, area: areas[at] ?? null }]))
}

/**
 * Write down where the books this write moved now belong.
 *
 * Writes an `assigned` row, not a `placed` one: these writes move a book in
 * the run and not in the room, which is exactly the disagreement between
 * `assigned` (what the rules want) and `placed` (what somebody did) that the
 * ledger exists to record. See docs/data-model.md.
 *
 * This does not replace `outstanding_move`, which answers "how do I put the
 * furniture back" and names no area, so nothing that counts outstanding work
 * reads it. A move that changes the run writes both, since both facts are
 * true of it.
 *
 * Scoped to the books whose plank actually changed, by comparing the run's
 * answer before against its answer after; `assignmentFor` decides the rest,
 * so a pinned, checked-out or withdrawn book gets nothing written.
 *
 * Reads the run's own walk rather than the claim ladder
 * `AssignPlacementsHandler` uses: that handler answers which rule claims a
 * book, while this answers where `runAreasOf` puts a key, the same walk
 * `Shelves.review` compares against.
 */
export async function recordWhatMoved(
  db: Db,
  range: ShelfRange,
  before: ReadonlyMap<number, RunAnswer>,
  reason: string,
  now: string,
): Promise<void> {
  const moved = [...(await whereTheRunPutsThem(db, range))]
    .filter(([id, answer]) => {
      const was = before.get(id)
      return was !== undefined && was.area !== answer.area
    })
  if (!moved.length) return

  const ledger = new DrizzlePlacementLedger(db)
  const history = new Map<number, Placement[]>()
  for (const row of await ledger.forBooks(moved.map(([id]) => id))) {
    const existing = history.get(row.bookId)
    if (existing) existing.push(row)
    else history.set(row.bookId, [row])
  }

  for (const [id, answer] of moved) {
    const to = assignmentFor(standingOf(history.get(id) ?? []), answer.area)
    if (to === null) continue
    await ledger.record({
      bookId: id,
      kind: 'assigned',
      areaId: to,
      sortKey: answer.sortKey,
      actor: 'rules',
      reason,
      createdAt: now,
    })
  }
}
