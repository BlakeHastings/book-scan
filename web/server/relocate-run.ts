/**
 * Move a run of books onto another bookcase: plan it, then apply it.
 *
 * The two halves of one idea, and they are deliberately in one file. **Plan
 * computes and writes nothing. Apply writes the furniture and then the
 * `assigned` rows the rules want, only where the answer differs from where the
 * book already is**, which is #185's rule and is `assignmentFor`'s job rather
 * than this file's.
 *
 * ## Nothing here moves a book
 *
 * Applying records an intention. The books move when a person carries them and
 * says so, through `PATCH /api/books/:id/location`, and the list of what is
 * still outstanding is the needs-attention list that already exists: an
 * assignment disagreeing with where the book was last seen. There is no second
 * queue here and there must not be one.
 *
 * ## Why apply re-plans instead of trusting what it was shown
 *
 * A plan is a proposal and the shelves can have moved under it, exactly as a
 * cascade's outer frame can (#106). So the apply reads the furniture again
 * inside its own transaction and refuses on the same terms the plan did, rather
 * than acting on a bookcase number a screen was holding.
 */

import {
  furnitureIn, plankLabels, relocateRunTo, ruleForRange,
} from '../infrastructure/shelving/areas'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { planPlacements, type PlacementPlan, type PlannableBook } from '../domain/placement/plan'
import { relocateRun, type EmptiedPiece, type PlankMove } from '../domain/placement/relocate'
import {
  AssignPlacementsHandler, type AssignableBook, type AssignmentReport,
} from '../application/placement/assign-placements'
import type { ShelfRange } from '../shared/shelving'
import type { Db } from './driver'
import { rangeLock } from './shelves'

/** A plan, and the furniture change it is a plan of. */
export interface RunMovePlan extends PlacementPlan {
  /** The bookcase the run starts on now. */
  from: number
  /** The bookcase it would start on. */
  to: number
  /** Every plank of the run, old label to new. Empty when it is already there. */
  planks: PlankMove[]
  /**
   * Every piece the move would leave standing with nothing on its face.
   *
   * **The half of this that is not about books** (#391). Nothing is deleted, and
   * a person still has to be told: a bookcase they put up after the run and have
   * not filled yet is the tail of that run, so moving the run takes its planks
   * and leaves it bare.
   */
  emptied: EmptiedPiece[]
}

export type Planned =
  | { ok: true; plan: RunMovePlan }
  | { ok: false; error: string }

export type Applied =
  | { ok: true; plan: RunMovePlan; wrote: AssignmentReport }
  | { ok: false; error: string }

interface BookRow {
  id: number
  title: string
  author_filing: string
  sort_key: string
  slugs: string[] | null
}

/**
 * The books of one run, with the tags a rule claims them by.
 *
 * `catalogued_books`, so a checked out or withdrawn book is here to be counted
 * as skipped rather than quietly absent, and `shelf_range` because that is the
 * run somebody is moving. A book whose genre tag disagrees with the range it is
 * filed in is not in this list and is not this feature's to find:
 * `areaDisagreements` already names those on every start.
 */
async function booksIn(db: Db, range: ShelfRange): Promise<PlannableBook[]> {
  const rows = await db.all<BookRow>(
    `SELECT b.id, b.title, b.author_filing, b.sort_key,
            array_remove(array_agg(t.slug), NULL) AS slugs
       FROM catalogued_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      WHERE b.shelf_range = ?
      GROUP BY b.id, b.title, b.author_filing, b.sort_key
      ORDER BY b.sort_key`,
    [range],
  )

  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    authorFiling: row.author_filing,
    sortKey: row.sort_key,
    tagSlugs: row.slugs ?? [],
  }))
}

/**
 * What moving this run would mean. **Writes nothing at all.**
 *
 * Also what the apply calls before it writes, so the answer somebody approves
 * and the answer that gets recorded are the same function rather than two
 * implementations that have to be kept saying the same thing.
 */
export async function planRunMove(db: Db, range: ShelfRange, to: number): Promise<Planned> {
  const { order, rules } = await furnitureIn(db)
  const rule = ruleForRange(rules, range)
  if (!rule) {
    return { ok: false, error: 'No rule files books into this run, so it lives nowhere to move.' }
  }

  const moved = relocateRun(order, rules, rule.id, to)
  if (!moved.ok) return moved

  const books = await booksIn(db, range)
  const rows = await new DrizzlePlacementLedger(db).forBooks(books.map((book) => book.id))

  return {
    ok: true,
    plan: {
      ...planPlacements(books, rows, moved.move.rules, moved.move.order, await plankLabels(db)),
      from: moved.move.from,
      to: moved.move.to,
      planks: moved.move.planks,
      emptied: moved.move.emptied,
    },
  }
}

/**
 * Move the run, and record where the rules now want every book.
 *
 * One transaction, serialised on the range, because between the furniture write
 * and the assignment run the range's rule points at planks nobody has been told
 * about yet, and a save landing in that window would place a book by half an
 * arrangement.
 *
 * **Safe to call twice.** The second call finds the run already on that bookcase
 * and moves no furniture, and `assignmentFor` finds every book already assigned
 * where the rules want it and writes nothing.
 */
export async function applyRunMove(
  db: Db,
  range: ShelfRange,
  to: number,
  now: string,
): Promise<Applied> {
  return db.tx(async (tx) => {
    const planned = await planRunMove(tx, range, to)
    if (!planned.ok) return planned

    await relocateRunTo(tx, range, to)

    const { order, rules } = await furnitureIn(tx)
    const books = await booksIn(tx, range)
    const assignable: AssignableBook[] = books.map((book) => ({
      id: book.id,
      sortKey: book.sortKey,
      tagSlugs: book.tagSlugs,
    }))

    const wrote = await new AssignPlacementsHandler(new DrizzlePlacementLedger(tx)).handle({
      books: assignable,
      rules,
      order,
      actor: 'rules',
      now,
    })

    return { ok: true, plan: planned.plan, wrote }
  }, { serialiseOn: rangeLock(range) })
}
