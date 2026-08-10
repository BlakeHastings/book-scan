/**
 * Recompute the derived filing columns of already-catalogued books, and say
 * which ones the answer has changed for.
 *
 * A book's `author_filing`, `title_filing` and `sort_key` are written once, when
 * somebody saves it, so they are as right as the code that was running that day
 * and no righter. Nothing recomputes them afterwards: `docs/shelving.md` says an
 * edit recomputes the key, and an edit is a person, not a deployment.
 *
 * That is fine while the derivation only ever gets things right, and #195 is
 * what it looks like when it does not. Every book whose author is written in a
 * script with no `A-Z` in it was stored filing under nobody, and fixing the
 * derivation leaves those rows exactly where they were, first in their range,
 * until each one is opened and saved by hand.
 *
 * So this is the thing that finds them. It derives every catalogued book's key
 * the way a save would, compares it with what is stored, and reports the
 * difference. It writes nothing unless it is told to, because the catalogue it
 * would write to is somebody's real book collection and a shelf order is not a
 * thing to change on a whim: see `server/refile-books.ts`, which is the front
 * end and which prints the target before it touches it.
 */

import type { Store } from './store'

export interface Refiled {
  id: number
  title: string
  /**
   * The name the recomputed key was built from, which is what the credited
   * alias files under.
   *
   * One name where this used to report two, before and after. There is no
   * stored filing name to be the "before" any more: #227 dropped
   * `books.author_filing`, so what a book files under is a fact about the
   * author and the only thing derived from it on the row is the sort key. The
   * two keys below are the before and after.
   */
  filesUnder: string
  sortKey: [string, string]
}

export interface RefileReport {
  examined: number
  /** Books whose derived key is not what is stored, in id order. */
  moved: Refiled[]
  /** How many rows were actually written. Zero on a dry run. */
  written: number
}

export interface RefileOptions {
  /** Write the recomputed columns. Without it nothing is written. */
  apply: boolean
}

export async function refileBooks(
  store: Store,
  options: RefileOptions,
): Promise<RefileReport> {
  const rows = await store.filingInputs()
  const moved: Refiled[] = []
  let written = 0

  for (const row of rows) {
    // The first-listed author, from the positional table where there is one.
    // A row saved before that table takes everything up to the first comma,
    // which is what the client does with the same joined string.
    const printed = row.printed_author || (row.authors.split(',')[0] ?? '').trim()

    // No genre in here, and there used to be one. `resolveKey` answered the
    // shelf range as well until #223, so recomputing a filing name meant
    // restating what the book was about; the range is decided by the genre tag
    // now, and recomputing a key still states nothing new about the book.
    const resolved = await store.resolveKey({
      title: row.title,
      authors: [printed],
      seriesName: row.series_name,
      seriesIndex: row.series_index,
    })

    // Both derived columns, not just the key. They are written by one
    // statement and a row where only one of them is stale is a row somebody
    // wrote by hand, which is exactly the row worth reporting.
    if (
      resolved.sortKey === row.sort_key &&
      resolved.titleFilingValue === row.title_filing
    ) {
      continue
    }

    moved.push({
      id: row.id,
      title: row.title,
      filesUnder: resolved.authorFiling,
      sortKey: [row.sort_key, resolved.sortKey],
    })

    if (options.apply) {
      await store.refile(row.id, resolved)
      written += 1
    }
  }

  return { examined: rows.length, moved, written }
}
