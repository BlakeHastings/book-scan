/**
 * What a write that changes the run costs somebody, written to the ledger.
 *
 * **One function, because there is one act here and not two.** #487 asked what
 * a boundary write records and #492 answered it: an `assigned` row per book
 * whose plank the write changed, decided by comparing the run's answer before
 * against its answer after. That reasoning was never about boundaries. It is
 * about a write that moves a book in the run without moving it in the room, and
 * a boundary is only one of the things that does that.
 *
 * **Renumbering a piece of furniture is another** (#491). `runAreasOf` orders
 * the run by `f.position, f.id, a.position`, so setting `fixture.position` puts
 * the run's planks in a different order — or, where a second piece already
 * stands at that number, drops a whole piece's planks out of the run — and
 * every book past the moved piece derives somewhere else. Nothing about the
 * ledger's answer changes because the door did: it is the same disagreement,
 * so it is the same row, written by the same comparison.
 *
 * This lives in its own module rather than in `shelves.ts` for the dull reason:
 * `shelves.ts` already imports `furniture.ts`, and the renumbering door is in
 * `furniture.ts`.
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
 * The same walk `shelvesForSortKeys` makes, answered as the row rather than as
 * the label: the boundary list that walk steps over is derived from these very
 * areas (`boundariesFrom`), so asking the run directly is one reading of one
 * sequence instead of two that have to agree.
 *
 * Null for every key when the range has no run at all, which is a rule pointing
 * at furniture that has been taken out. That is a fact about the furniture and
 * the review says so out loud rather than quietly judging nothing.
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
 * The same walk `review` compares against and the same one `areasForSortKeys`
 * answers, read as plank ids rather than as labels. Ids on purpose: these writes
 * are exactly the thing that makes one plank read as another one's label, so a
 * before-and-after taken in labels would report a book as moved when only the
 * letter under it changed, and would miss one that moved onto a plank whose
 * letter it already had. That is #356 in the one place it still had left to
 * bite, and #491 is what it looks like when the letters collide: five of its six
 * rows read "last seen on 1B, now puts it on 1B" over two different planks.
 *
 * Lean deliberately. `layout` joins photographs and placements onto every row
 * because it draws a shelf; this decides which books to write a row for, and it
 * is taken twice per write.
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
 * **This is the recording every write that moves the run owes, and it is one
 * function because it is one act** (#487, #492). `docs/shelving.md` says so in
 * the sentence that specifies the boundary move: the manual move and the
 * automatic shuffle "answer the same physical question, and if they wrote
 * different things down one would quietly undo the other". Overflow wrote
 * nothing at all, a boundary move wrote only its own receipt, and a removal
 * wrote assignments (#465), so there were three answers to that one question.
 * Renumbering a piece was the fourth and wrote nothing (#491).
 *
 * **An `assigned` row is what the act produces, and the ledger's own words
 * settle which row it is.** `docs/data-model.md`: "`assigned` is what the rules
 * want; `placed` is what somebody did. They disagree exactly when a book needs
 * attention." These writes move a book in the run and not in the room, which is
 * precisely that disagreement, so a book left needing attention with no
 * `assigned` row is the model contradicting itself. It is also the whole of
 * #458: the needs-attention list derives its answer and the carry list reads the
 * ledger, so the ledger going unwritten is a first screen saying nothing is
 * outstanding over work that is.
 *
 * **The receipt is not this and cannot stand in for it.** `outstanding_move`
 * answers "how do I put the furniture back", which is why only a move that can
 * be taken back writes one, and it names no area: nothing that counts work reads
 * it. A move writes both, because both facts are true of it.
 *
 * **Scoped to the books this write actually moved**, by comparing the run's
 * answer before against its answer after. A book whose plank did not change has
 * nothing new to say, and a wider sweep would re-derive assignments over books
 * the act never touched. `assignmentFor` decides the rest, so a pinned, checked
 * out or withdrawn book gets nothing, and neither does one already standing
 * where it now belongs.
 *
 * **The run's own walk and not the claim ladder**, which is why this is not
 * `AssignPlacementsHandler`. That handler answers which rule claims a book and
 * writes the area that rule's arrangement lands it in; this answers where
 * `runAreasOf` puts a key, which is the walk `Shelves.review` compares against.
 * #491's symptom is the two of them disagreeing about the same books, so the
 * only recording that closes it is the one taken from the same walk.
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
