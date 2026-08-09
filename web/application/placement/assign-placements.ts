/**
 * Running the rules over a catalogue, and writing down only what changed.
 *
 * **`assigned` is what the rules want; `placed` is what somebody did**, and the
 * whole value of keeping both is lost if the first is written indiscriminately.
 * A run over a settled catalogue that appended a row per book would double the
 * ledger every time it ran, say nothing in any of the rows, and bury the ones
 * that mean something. So this writes a row for a book **only where the rules'
 * answer differs from where that book already is**, which is `assignmentFor` in
 * `domain/placement/ledger.ts` and is asserted here by counting: a second run
 * that changes nothing writes nothing.
 *
 * Three kinds of book are skipped and each is reported rather than dropped:
 *
 * - **pinned**, because a pin beats every rule forever. That is the escape hatch
 *   from the rule system and it is a person overruling it, so the engine leaves
 *   the book alone and unpinning is another row.
 * - **withdrawn and checked out**, because neither is anywhere. A book that comes
 *   back is placed again then, not now.
 * - **unclaimed**, where no rule matches the book at all. Null is a real answer
 *   from `placementOf` and it is reported here rather than papered over: a book
 *   no rule claims has nowhere the rules can put it, and saying so is how the
 *   person who wrote the rules finds out.
 *
 * Nothing here reads a clock or a database directly. The furniture, the rules
 * and the moment all arrive on the command, so the same run can be made over a
 * catalogue in a test and over one in a migration rehearsal and give the same
 * answer.
 */

import { assignmentFor, standingOf, type Placement, type PlacementActor } from '../../domain/placement/ledger'
import type { Slot } from '../../domain/placement/geography'
import { placementOf, type PlacementRule } from '../../domain/placement/rules'
import type { PlacementLedger } from './ports'

/** What a rule needs to know about a book in order to claim and place it. */
export interface AssignableBook {
  id: number
  sortKey: string
  tagSlugs: readonly string[]
}

export interface AssignPlacements {
  books: readonly AssignableBook[]
  rules: PlacementRule[]
  /** Every area in the collection, in the order a book meets them. */
  order: Slot[]
  /** Who is running this. `rules` in the app; `migration` in a rehearsal. */
  actor: PlacementActor
  now: string
}

/**
 * What a run did, in the four numbers worth reporting, plus the books nothing
 * claimed.
 *
 * `unchanged` is the one to watch. On a catalogue in agreement with its rules it
 * is every book, and a run that reports otherwise is either the first one or a
 * sign that something moved.
 */
export interface AssignmentReport {
  assigned: number
  unchanged: number
  skipped: number
  /** Books no rule claims, by id. The rules have nowhere to put them. */
  unclaimed: number[]
}

function rowsByBook(rows: readonly Placement[]): Map<number, Placement[]> {
  const grouped = new Map<number, Placement[]>()
  for (const row of rows) {
    const existing = grouped.get(row.bookId)
    if (existing) existing.push(row)
    else grouped.set(row.bookId, [row])
  }
  return grouped
}

export class AssignPlacementsHandler {
  constructor(private readonly ledger: PlacementLedger) {}

  async handle(command: AssignPlacements): Promise<AssignmentReport> {
    const { books, rules, order, actor, now } = command
    const history = rowsByBook(await this.ledger.forBooks(books.map((book) => book.id)))

    const report: AssignmentReport = { assigned: 0, unchanged: 0, skipped: 0, unclaimed: [] }

    for (const book of books) {
      const standing = standingOf(history.get(book.id) ?? [])
      if (standing.pinned || standing.withdrawn || standing.checkedOut) {
        report.skipped += 1
        continue
      }

      const found = placementOf(book, rules, order)
      if (!found) {
        report.unclaimed.push(book.id)
        continue
      }

      const wanted = assignmentFor(standing, found.slot.area.id)
      if (wanted === null) {
        report.unchanged += 1
        continue
      }

      await this.ledger.record({
        bookId: book.id,
        kind: 'assigned',
        areaId: wanted,
        sortKey: book.sortKey,
        ruleId: found.rule.id,
        actor,
        // The rule's name, because the question a person asks of an assignment
        // is why, and the answer is which rule claimed the book.
        reason: found.rule.name,
        createdAt: now,
      })
      report.assigned += 1
    }

    return report
  }
}
