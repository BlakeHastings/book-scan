/**
 * Where things are, worked out from this file rather than from the working
 * directory, so the suite runs the same whether it is started from `e2e/`, the
 * repo root, or an editor.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** e2e/ */
export const E2E_ROOT = resolve(here, '..')

/** The repository root, which is where the AppHost lives. */
export const REPO_ROOT = resolve(E2E_ROOT, '..')

/** The web package, whose toolchain generates the camera fixtures. */
export const WEB_ROOT = join(REPO_ROOT, 'web')

/** Generated camera videos. Large, derived and git-ignored. */
export const FIXTURE_DIR = join(E2E_ROOT, '.fixtures')

/**
 * The camera file for a given ISBN.
 *
 * Computed rather than passed around because Chromium is handed it as a
 * command line flag, which the Playwright config builds before any setup code
 * has run.
 */
export function cameraVideoFor(isbn: string): string {
  return join(FIXTURE_DIR, `back-cover-${isbn}.y4m`)
}

/**
 * The camera file showing a front cover, for the scenarios about a book held
 * up rather than a barcode presented.
 *
 * A separate file and therefore a separate Playwright project, because the
 * video is a launch argument. It has to be a front: a back cover carries a
 * barcode, the scan route reads it first and answers from the catalogue, and
 * nothing that depends on the cover comparison is reached at all.
 */
export function frontCameraVideoFor(title: string): string {
  return join(FIXTURE_DIR, `front-cover-${title.replace(/[^a-z0-9]+/gi, '-')}.y4m`)
}
