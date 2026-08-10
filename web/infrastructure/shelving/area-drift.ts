/**
 * The check that lets one set of rows decide where every book goes.
 *
 * **This is #184's book-by-book comparison, and it has now outlived both the
 * things it was written to compare.** #184 placed every one of 236 books twice,
 * once by `separators` and once by the areas `0013` derived from them, and
 * proved the two answers identical at the moment of the backfill. #213 made that
 * continuous, because the first boundary somebody moved, the claim was about a
 * catalogue that no longer existed. #232 dropped `separators`, and the question
 * is what a comparison with one model left is worth.
 *
 * **It is worth what it always was, because there were never two models here:
 * there were two ways of asking one set of rows where a book goes, and both of
 * them survive the drop.**
 *
 * - `underTheLayout` is what the app draws. It takes the range off
 *   `books.shelf_range`, reads that range's band, turns the areas in it back
 *   into a boundary list and walks it with `layoutRange`, which is exactly the
 *   sequence `Shelves.layout` performs.
 * - `underRules` is what the model says. It takes no notice of `shelf_range`: it
 *   asks which `placement_rule` claims the book by the tags it carries, follows
 *   that rule's run through `slotsInOrder`, and lands the book by its sort key.
 *
 * The inputs are different all the way down. One is a column and a walk over a
 * derived boundary list; the other is `book_tag`, the rules and the sequence of
 * areas. They agree only when the range a book's genre settled on is the range
 * the rules claim it into, and when the boundary list really is the inverse of
 * the areas it was derived from. Both of those are things that can be wrong, and
 * both of them are wrong in the way that matters: silently, and about a shelf in
 * somebody's house.
 *
 * What it stopped being able to catch is a boundary written into `separators`
 * without an area beside it, and that is because there is no `separators`.
 *
 * ## Two readings, neither of them this file's own
 *
 * Nothing here re-implements a placement. `underTheLayout` calls `layoutRange`,
 * which is what `Shelves.layout` calls; `underRules` calls `placementOf` over
 * `slotsInOrder`, which is the whole of the model. A check that walked the areas
 * itself would agree with whichever of the two it was written from and say
 * nothing about the other.
 *
 * It is deliberately not the derivation `areas.ts` writes with, either. A writer
 * checked by its own arithmetic proves that it is self-consistent, which is the
 * one thing that was never in doubt.
 *
 * ## Reported, not repaired
 *
 * Nothing here writes. Repairing on sight would destroy the evidence of how a
 * disagreement happened, which is the only question one actually asks, in the
 * same way `rebuildProjection` is a decision somebody makes having read the
 * report (#185).
 */

import { labelFor } from '../../domain/placement/geography'
import { placementOf } from '../../domain/placement/rules'
import { GENRE_RANGES } from '../../domain/tagging/genre'
import type { Db } from '../../server/driver'
import { layoutRange } from '../../shared/layout'
import { bandsOf, boundariesOf, furnitureIn } from './areas'

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
 * Where the app draws every shelved book, range by range.
 *
 * The three reads are `Shelves.startOf`, `Shelves.booksIn` and
 * `DrizzleSeparatorRepository.inRange` spelled out, in that order and with those
 * orderings, because the order the boundaries come back in is what decides where
 * two sharing an anchor are stepped over.
 */
async function underTheLayout(db: Db): Promise<Map<number, { title: string; label: string }>> {
  const placed = new Map<number, { title: string; label: string }>()
  const bands = await bandsOf(db)

  for (const { range } of GENRE_RANGES) {
    const band = bands.get(range)
    if (!band) continue

    const books = await db.all<BookRow>(
      'SELECT id, title, sort_key FROM shelved_books WHERE shelf_range = ? ORDER BY sort_key ASC',
      [range],
    )

    const layout = layoutRange(
      books.map((row) => ({ id: row.id, title: row.title, sortKey: row.sort_key })),
      await boundariesOf(db, range),
      band.start,
    )

    for (const one of layout) {
      placed.set(one.book.id, { title: one.book.title, label: one.label })
    }
  }

  return placed
}

/** Where the rules and the areas put every shelved book, run through the domain. */
async function underRules(db: Db): Promise<Map<number, string>> {
  const { order, rules } = await furnitureIn(db)

  const books = await db.all<BookRow & { slugs: string[] }>(
    `SELECT b.id, b.title, b.sort_key,
            array_remove(array_agg(t.slug), NULL) AS slugs
       FROM shelved_books b
       LEFT JOIN book_tag bt ON bt.book_id = b.id
       LEFT JOIN tag t ON t.id = bt.tag_id
      GROUP BY b.id, b.title, b.sort_key`,
  )

  const placed = new Map<number, string>()
  for (const row of books) {
    const found = placementOf({ sortKey: row.sort_key, tagSlugs: row.slugs ?? [] }, rules, order)
    // Empty rather than thrown, so a book the rules cannot place shows up as a
    // disagreement instead of stopping the check.
    placed.set(row.id, found ? labelFor(found.slot) : '')
  }
  return placed
}

/**
 * Every shelved book the layout and the rules put in different places.
 *
 * Ordered by id, which is the order the backfill tests already read, and
 * unbounded: the caller decides how many to say out loud, because the total is
 * the number that matters and the names are the ones that explain it.
 */
export async function areaDisagreements(db: Db): Promise<AreaDisagreement[]> {
  const [layout, rules] = await Promise.all([underTheLayout(db), underRules(db)])

  const found: AreaDisagreement[] = []
  for (const [bookId, { title, label }] of layout) {
    const fromRules = rules.get(bookId) ?? ''
    if (fromRules !== label) {
      found.push({ bookId, title, fromLayout: label, fromRules })
    }
  }

  return found.sort((a, b) => a.bookId - b.bookId)
}
