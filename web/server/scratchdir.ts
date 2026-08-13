/**
 * Where a test file that writes files gets a directory of its own.
 *
 * Test support only, like `testdb.ts` beside it. Nothing the server runs
 * imports this, and nothing here reads `BOOKSCAN_DATA`: `createApp` takes
 * `coverDir` as an option, and the only code that resolves a data directory
 * out of the environment is the startup path in `index.ts` that no test runs.
 *
 * **The point is that there is no shared parent left to race over.** Five test
 * files used to make their scratch directories inside `web/data`, and
 * `index.test.ts` finished by removing the whole of `web/data` rather than the
 * temporary directory it had made in it. Vitest runs test files in parallel, so
 * "the end of its own run" is the middle of somebody else's: the other four
 * were still creating and writing directories in there, and a run died with
 * `ENOENT: no such file or directory, mkdtemp` in whichever file happened to be
 * holding the directory when another one emptied it. Two runs in four on a
 * developer's machine, and never once on CI, whose file ordering happened to
 * finish the deleting file last (#297).
 *
 * So each file now takes a root that nothing else can name: `mkdtemp` picks the
 * six random characters, and a file removes that root and nothing above it.
 * A cleanup that cannot spell another file's directory cannot delete one,
 * whatever order the files run in and however many run at once. That is a
 * property of the shape rather than of the timing, which is why it is worth
 * more than a retry or a serial run would be: neither of those removes the
 * sharing, and one of them makes every run slower for everybody.
 *
 * These roots sit directly under `web/`, not under `web/data`, and that is the
 * other half of it. `npm test` no longer touches `web/data` at all, so a
 * scratch catalogue or a copied cover parked there survives a run. Losing 1.1
 * GB of those to one `npm test` is how the old behaviour was found.
 * `web/.gitignore` excludes them by name.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `web/`, resolved from this file rather than from wherever vitest was started. */
const WEB_DIR = fileURLToPath(new URL('../', import.meta.url))

/**
 * A new empty directory for the calling test file, and only for it.
 *
 * Call it once, from a `beforeAll`. `label` names the file asking, so a root
 * left behind by a run somebody killed says which file made it; it is not what
 * makes the name unique, `mkdtemp` is. Anything a file wants per test goes in a
 * `mkdtemp` inside this one, which is a directory no other file can reach
 * either.
 */
export function scratchRoot(label: string): string {
  return mkdtempSync(join(WEB_DIR, `.scratch-${label}-`))
}

/**
 * Give the root back, from an `afterAll`, so a run leaves nothing behind.
 *
 * Takes `undefined` on purpose. A file whose `beforeAll` threw has no root, and
 * an `afterAll` that fails on that is a second error standing in front of the
 * one that matters.
 */
export function removeScratchRoot(root: string | undefined): void {
  if (!root) return
  rmSync(root, { recursive: true, force: true })
}
