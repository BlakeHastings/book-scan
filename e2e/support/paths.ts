/**
 * Where things are, worked out from this file rather than from the working
 * directory, so the suite runs the same whether it is started from `e2e/`, the
 * repo root, or an editor.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export const E2E_ROOT = resolve(here, '..')

export const REPO_ROOT = resolve(E2E_ROOT, '..')

export const WEB_ROOT = join(REPO_ROOT, 'web')

export const FIXTURE_DIR = join(E2E_ROOT, '.fixtures')

/**
 * Computed rather than passed around: Chromium is handed this path as a
 * command line flag that the Playwright config builds before any setup code
 * has run.
 */
export function cameraVideoFor(isbn: string): string {
  return join(FIXTURE_DIR, `back-cover-${isbn}.y4m`)
}

/**
 * A separate file, and therefore a separate Playwright project, because the
 * video is a launch argument. It must be a front cover: a back cover carries a
 * barcode, and the scan route reads that first without reaching the cover
 * comparison.
 */
export function frontCameraVideoFor(title: string): string {
  return join(FIXTURE_DIR, `front-cover-${title.replace(/[^a-z0-9]+/gi, '-')}.y4m`)
}
