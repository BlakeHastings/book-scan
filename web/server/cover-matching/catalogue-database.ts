/**
 * Where a matcher that searches Postgres keeps its catalogue while it is
 * measured.
 *
 * The cover-text matcher is scored through the query the app runs, `pg_trgm`
 * and all, rather than a copy of its arithmetic in TypeScript, so it needs a
 * database. Whoever runs the harness says which, once, before scoring:
 * `floors.test.ts` hands over the suite's own scratch database and
 * `scripts/cover-matchers.ts` starts one. Each `prepare` asks for an empty one.
 */

import type { Db } from '../driver'

let open: (() => Promise<Db>) | undefined

export function useCatalogueDatabase(opener: () => Promise<Db>): void {
  open = opener
}

/** An empty, migrated catalogue. */
export function catalogueDatabase(): Promise<Db> {
  if (!open) {
    throw new Error(
      'This matcher keeps its catalogue in Postgres, and nothing said which: '
      + 'call useCatalogueDatabase before scoring it.',
    )
  }
  return open()
}
