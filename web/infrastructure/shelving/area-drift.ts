/**
 * The check that lets one set of rows decide where every book goes.
 *
 * There were never two models here: there are two ways of asking one set
 * of rows where a book goes.
 *
 * - `underTheLayout` is what the app draws: it takes the range off
 *   `books.shelf_range`, reads that range's band, turns the areas in it
 *   back into a boundary list and walks it with `layoutRange`, the exact
 *   sequence `Shelves.layout` performs.
 * - `underRules` is what the model says: it takes no notice of
 *   `shelf_range`, asks which `placement_rule` claims the book by the tags
 *   it carries, follows that rule's run through `slotsInOrder`, and lands
 *   the book by its sort key.
 *
 * They agree only when the range a book's genre settled on is the range
 * the rules claim it into, and when the boundary list really is the
 * inverse of the areas it was derived from. Both of those can be wrong
 * silently, about a shelf in somebody's house.
 *
 * Nothing here re-implements a placement: `underTheLayout` calls
 * `layoutRange`, the same function `Shelves.layout` calls, and `underRules`
 * calls `placementOf` over `slotsInOrder`, the whole of the model. It is
 * also deliberately not the derivation `areas.ts` writes with: a writer
 * checked by its own arithmetic only proves it is self-consistent.
 *
 * It compares area ids, not labels. The two readings render a label with
 * different functions: `layoutRange` renders from ordinals, the rules
 * render through `labelFor`, which is the name a person gave the piece.
 * Comparing the rendered strings would disagree on every correctly
 * shelved book the moment a bookcase is given a name, since one side says
 * `2A` and the other `Hall shelf · A` about the same plank. `areaOfKey`
 * turns the layout's walk into the row it landed on, the same reader
 * `Shelves` answers "where does this book belong" with.
 *
 * Nothing here writes. Repairing on sight would destroy the evidence of
 * how a disagreement happened, which is the only question one actually
 * asks.
 */

import { labelFor } from '../../domain/placement/geography'
import { placementOf } from '../../domain/placement/rules'
import { GENRE_RANGES } from '../../domain/tagging/genre'
import type { Db } from '../../server/driver'
import { layoutRange } from '../../shared/layout'
import { areaOfKey, bandsOf, boundariesFrom, furnitureIn, runAreasOf } from './areas'

/** One book the two readings put in different places. */
export interface AreaDisagreement {
  bookId: number
  title: string
  /** The plank the layout draws it on, which is where the app puts it. */
  fromLayout: string
  /** The plank the areas and the rules put it on, or '' when nothing claims it. */
  fromRules: string
}

/** The disagreement said the way a reviewer reads it, in one line. */
export function describeAreaDisagreement(one: AreaDisagreement): string {
  return `${one.title}: the layout says ${one.fromLayout}, ` +
    `the rules say ${one.fromRules || 'nowhere'}`
}

interface BookRow {
  id: number
  title: string
  sort_key: string
}

/**
 * Where the app draws every shelved book, range by range. The three reads
 * are `Shelves.startOf`, `Shelves.booksIn` and
 * `DrizzleSeparatorRepository.inRange` spelled out, in that order: the
 * order boundaries come back in decides where two sharing an anchor are
 * stepped over.
 */
async function underTheLayout(
  db: Db,
): Promise<Map<number, { title: string; label: string; areaId: number | null }>> {
  const placed = new Map<number, { title: string; label: string; areaId: number | null }>()
  const bands = await bandsOf(db)

  for (const { range } of GENRE_RANGES) {
    const band = bands.get(range)
    if (!band) continue

    const books = await db.all<BookRow>(
      'SELECT id, title, sort_key FROM shelved_books WHERE shelf_range = ? ORDER BY sort_key ASC',
      [range],
    )

    // One read of the run, used both ways: the boundary list the layout
    // walks is derived from these rows, so the plank a book lands on and
    // the plank drawn are two readings of one sequence.
    const run = await runAreasOf(db, range)
    const layout = layoutRange(
      books.map((row) => ({ id: row.id, title: row.title, sortKey: row.sort_key })),
      boundariesFrom(range, run),
      band.start,
    )

    for (const one of layout) {
      placed.set(one.book.id, {
        title: one.book.title,
        label: one.label,
        areaId: areaOfKey(run, one.book.sortKey)?.id ?? null,
      })
    }
  }

  return placed
}

/** Where the rules and the areas put every shelved book, run through the domain. */
async function underRules(
  db: Db,
): Promise<Map<number, { label: string; areaId: number | null }>> {
  const { order, rules } = await furnitureIn(db)

  const books = await db.all<BookRow & { slugs: string[] }>(
    `SELECT b.id, b.title, b.sort_key,
            array_remove(array_agg(t.slug), NULL) AS slugs
       FROM shelved_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      GROUP BY b.id, b.title, b.sort_key`,
  )

  const placed = new Map<number, { label: string; areaId: number | null }>()
  for (const row of books) {
    const found = placementOf({ sortKey: row.sort_key, tagSlugs: row.slugs ?? [] }, rules, order)
    // Nothing rather than thrown, so a book the rules cannot place shows up as a
    // disagreement instead of stopping the check.
    placed.set(row.id, found
      ? { label: labelFor(found.slot), areaId: found.slot.area.id }
      : { label: '', areaId: null })
  }
  return placed
}

/**
 * Every shelved book the layout and the rules put in different places.
 * Ordered by id and unbounded: the caller decides how many to say out
 * loud, since the total is the number that matters.
 */
export async function areaDisagreements(db: Db): Promise<AreaDisagreement[]> {
  const [layout, rules] = await Promise.all([underTheLayout(db), underRules(db)])

  const found: AreaDisagreement[] = []
  for (const [bookId, { title, label, areaId }] of layout) {
    const claimed = rules.get(bookId) ?? { label: '', areaId: null }
    // The plank, not what it is called.
    if (areaId === null || claimed.areaId !== areaId) {
      found.push({ bookId, title, fromLayout: label, fromRules: claimed.label })
    }
  }

  return found.sort((a, b) => a.bookId - b.bookId)
}
