/**
 * Recompute the derived filing columns of already-catalogued books, and say
 * which ones the answer has changed for.
 *
 * A book's `author_filing`, `title_filing` and `sort_key` are written once,
 * when somebody saves it, and nothing recomputes them afterwards. This
 * derives every catalogued book's key the way a save would, compares it with
 * what is stored, and reports the difference. It writes nothing unless told
 * to: see `server/refile-books.ts`, the front end, which prints the target
 * before it touches it.
 */

import type { Store } from './store'

export interface Refiled {
  id: number
  title: string
  /**
   * The name the recomputed key was built from, which is what the credited
   * alias files under. There is no stored filing name to compare against:
   * the two keys below are the before and after.
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
    // The first-listed author, from the positional table where there is one;
    // a row saved before that table takes everything up to the first comma.
    const printed = row.printed_author || (row.authors.split(',')[0] ?? '').trim()

    // No genre here: the shelf range is decided by the genre tag, not by
    // this, so recomputing a key states nothing new about the book.
    const resolved = await store.resolveKey({
      title: row.title,
      authors: [printed],
      seriesName: row.series_name,
      seriesIndex: row.series_index,
    })

    // Checks both derived columns, not just the key: a row where only one is
    // stale is one somebody edited by hand, exactly the row worth reporting.
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
