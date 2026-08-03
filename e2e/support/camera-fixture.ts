/**
 * Making the file Chromium plays as a camera.
 *
 * The generator itself lives in `web/scripts/e2e-video-fixture.ts` so that it
 * can use the cover fixtures the unit tests already read barcodes out of. It
 * is run here as a child process rather than imported, because it needs the
 * web package's own dependencies (sharp, bwip-js) and its own TypeScript
 * toolchain, and reaching sideways into another package's node_modules is a
 * good way to get a mystery on somebody else's machine.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { existsSync, statSync } from 'node:fs'

import { WEB_ROOT, cameraVideoFor } from './paths.js'

const run = promisify(execFile)

/**
 * tsx's entry point, addressed directly.
 *
 * Not `npm run` and not `npx`: on Windows both of those are `.cmd` shims,
 * which Node refuses to spawn without a shell, and a shell would need every
 * path quoted by hand. Node running a `.mjs` file needs neither.
 */
const TSX = join(WEB_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const GENERATOR = join(WEB_ROOT, 'scripts', 'e2e-video-fixture.ts')

/**
 * Generate the camera video for one ISBN, unless it is already current.
 *
 * "Current" means newer than the generator and the cover fixtures it draws
 * with, so an edit to either produces a new video rather than a stale one that
 * silently keeps passing.
 */
export async function ensureCameraVideo(isbn: string): Promise<string> {
  const out = cameraVideoFor(isbn)

  if (!existsSync(TSX)) {
    throw new Error(
      `${TSX} is missing. Run \`npm ci\` in web/ before the end to end suite: ` +
      'the camera fixtures are generated with that package\'s toolchain.',
    )
  }

  const sources = [GENERATOR, join(WEB_ROOT, 'server', 'fixtures.ts')]
  const newest = Math.max(...sources.map((file) => statSync(file).mtimeMs))

  if (existsSync(out) && statSync(out).mtimeMs > newest) return out

  await run(process.execPath, [TSX, GENERATOR, 'back', isbn, out], {
    cwd: WEB_ROOT,
    timeout: 5 * 60 * 1000,
    windowsHide: true,
  })

  if (!existsSync(out)) throw new Error(`The camera fixture ${out} was not written.`)
  return out
}
