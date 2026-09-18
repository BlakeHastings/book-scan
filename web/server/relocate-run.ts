/**
 * Move a run of books onto another bookcase: plan it, then apply it.
 *
 * Plan computes and writes nothing. Apply writes the furniture and then the
 * `assigned` rows the rules want, only where the answer differs from where
 * the book already is; that is `assignmentFor`'s job, not this file's.
 *
 * Applying records an intention; books move only through
 * `PATCH /api/books/:id/location`. Apply re-plans rather than trusting what
 * it was shown, since the shelves can have moved under the plan: it reads
 * the furniture again inside its own transaction and refuses on the same
 * terms.
 */

import {
  areasStanding, furnitureIn, plankLabels, relocateRunTo, ruleForRange,
} from '../infrastructure/shelving/areas'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { planPlacements, type PlacementPlan, type PlannableBook } from '../domain/placement/plan'
import {
  relocateRun, runToMove, type EmptiedPiece, type PlankMove,
} from '../domain/placement/relocate'
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
   * Nothing is deleted; a bookcase put up after the run and not yet filled is
   * the tail of that run, so moving the run takes its planks and leaves it
   * bare.
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
 * Reads `catalogued_books`, so a checked-out or withdrawn book is counted as
 * skipped rather than quietly absent. A book whose genre tag disagrees with
 * the range it is filed in is not in this list; `areaDisagreements` already
 * names those on every start.
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

/** One plank of a run, as the card describing it reads. */
export interface RunPlank {
  label: string
  /** Books standing on it, which is where somebody last said they were. */
  books: number
}

/**
 * Where a run lives, what it is cut into, and whether it can be moved at all.
 *
 * Where a run lives is where its rule points, not wherever its first book
 * happens to be standing: an empty leading bookcase can make those two
 * different bookcases. What the run is cut into includes planks holding
 * nothing, since dropping them would make a run with an empty shelf at the
 * top look like it started one bookcase further along.
 *
 * `why` is an answer rather than an error: a run a move cannot pick up is an
 * ordinary arrangement, so the screen is told before it offers anything
 * rather than after somebody has chosen.
 */
export interface RunMoveOffer {
  /** The bookcase the run starts on, or null when its rule points nowhere. */
  from: number | null
  planks: RunPlank[]
  /** Why this run cannot be moved, or null when it can. */
  why: string | null
}

/** What the screen needs before it draws a single destination. Writes nothing. */
export async function runMoveOffer(db: Db, range: ShelfRange): Promise<RunMoveOffer> {
  const { order, rules } = await furnitureIn(db)
  const rule = ruleForRange(rules, range)
  if (!rule) return { from: null, planks: [], why: NO_RULE }

  const movable = runToMove(order, rules, rule.id)
  if (!movable.ok) return { from: movable.from, planks: [], why: movable.error }

  /*
   * The label and the count come off the same row, from `areasStanding`, the
   * one statement in the app that counts books standing on an area, so a
   * plank the screen names and counts cannot come from two different readings.
   */
  const standing = new Map((await areasStanding(db)).map((area) => [area.id, area]))

  return {
    from: movable.move.from,
    planks: movable.move.planks.map((slot) => ({
      label: standing.get(slot.area.id)?.label ?? '',
      books: standing.get(slot.area.id)?.books ?? 0,
    })),
    why: null,
  }
}

/** Said in one place, because the plan and the offer refuse it on the same terms. */
const NO_RULE = 'No rule files books into this run, so it lives nowhere to move.'

/**
 * What moving this run would mean. Writes nothing.
 *
 * Also what apply calls before it writes, so the plan somebody approves and
 * the plan that gets recorded are the same function.
 */
export async function planRunMove(db: Db, range: ShelfRange, to: number): Promise<Planned> {
  const { order, rules } = await furnitureIn(db)
  const rule = ruleForRange(rules, range)
  if (!rule) return { ok: false, error: NO_RULE }

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
 * One transaction, serialised on the range: between the furniture write and
 * the assignment run, the range's rule points at planks nobody has been told
 * about yet, and a save landing in that window would place a book by half an
 * arrangement.
 *
 * Safe to call twice: the second call finds the run already on that bookcase
 * and moves no furniture, and `assignmentFor` finds every book already
 * assigned where the rules want it and writes nothing.
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
