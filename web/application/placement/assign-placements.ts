/**
 * Runs the rules over a catalogue, writing down only what changed.
 *
 * `assigned` is what the rules want, `placed` is what somebody did. A row is
 * written only where the rules' answer differs from where a book already is
 * (`assignmentFor` in `domain/placement/ledger.ts`); otherwise a settled
 * catalogue would double the ledger on every run.
 *
 * Skipped and reported, not dropped: pinned (a person overruling the rules),
 * withdrawn or checked out (not anywhere to be placed), and unclaimed (no
 * rule matches, so the rules have nowhere to put the book).
 *
 * Nothing here reads a clock or a database directly: furniture, rules and
 * moment all arrive on the command, so a test and a migration rehearsal give
 * the same answer.
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

/** `unchanged` is the one to watch: on a catalogue in agreement with its rules, it is every book. */
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
        // The rule's name: the question a person asks of an assignment is why.
        reason: found.rule.name,
        createdAt: now,
      })
      report.assigned += 1
    }

    return report
  }
}
