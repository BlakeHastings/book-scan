/**
 * Where a test file that writes files gets a directory of its own.
 *
 * Test support only, like `testdb.ts` beside it. Nothing the server runs
 * imports this, and nothing here reads `BOOKSCAN_DATA`.
 *
 * Each file takes a root that nothing else can name: `mkdtemp` picks the
 * random suffix, and a file removes only that root. A cleanup that cannot
 * spell another file's directory cannot delete one, whatever order the files
 * run in and however many run at once.
 *
 * These roots sit directly under `web/`, not under `web/data`, so `npm test`
 * never touches `web/data`; `web/.gitignore` excludes them by name.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `web/`, resolved from this file rather than from wherever vitest was started. */
const WEB_DIR = fileURLToPath(new URL('../', import.meta.url))

/**
 * A new empty directory for the calling test file, and only for it.
 *
 * Call once, from a `beforeAll`. `label` names the file asking, for a root
 * left behind by a killed run; it is not what makes the name unique, `mkdtemp`
 * is.
 */
export function scratchRoot(label: string): string {
  return mkdtempSync(join(WEB_DIR, `.scratch-${label}-`))
}

/**
 * Give the root back, from an `afterAll`, so a run leaves nothing behind.
 *
 * Takes `undefined` on purpose: a file whose `beforeAll` threw has no root,
 * and an `afterAll` that fails on that would be a second error in front of
 * the one that matters.
 */
export function removeScratchRoot(root: string | undefined): void {
  if (!root) return
  rmSync(root, { recursive: true, force: true })
}
