/**
 * Making the file Chromium plays as a camera.
 *
 * Run as a child process rather than imported: the generator, in
 * `web/scripts/e2e-video-fixture.ts`, needs the web package's own
 * dependencies (sharp, bwip-js) and its own TypeScript toolchain.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { existsSync, statSync } from 'node:fs'

import { WEB_ROOT, cameraVideoFor, frontCameraVideoFor } from './paths.js'

const run = promisify(execFile)

/**
 * tsx's entry point, addressed directly.
 *
 * Not `npm run` or `npx`: on Windows both are `.cmd` shims, which Node
 * refuses to spawn without a shell.
 */
const TSX = join(WEB_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const GENERATOR = join(WEB_ROOT, 'scripts', 'e2e-video-fixture.ts')

/**
 * Generates the video unless it is already newer than the generator and the
 * cover fixtures it draws with, so an edit to either produces a fresh video
 * rather than a stale one that silently keeps passing.
 */
export async function ensureCameraVideo(isbn: string): Promise<string> {
  return generate(cameraVideoFor(isbn), ['back', isbn])
}

/** Same generator and freshness rule as `ensureCameraVideo`, showing a front cover instead. */
export async function ensureFrontCameraVideo(title: string, author: string): Promise<string> {
  return generate(frontCameraVideoFor(title), ['front', title, author])
}

async function generate(out: string, args: string[]): Promise<string> {
  if (!existsSync(TSX)) {
    throw new Error(
      `${TSX} is missing. Run \`npm ci\` in web/ before the end to end suite: ` +
      'the camera fixtures are generated with that package\'s toolchain.',
    )
  }

  const sources = [GENERATOR, join(WEB_ROOT, 'server', 'fixtures.ts')]
  const newest = Math.max(...sources.map((file) => statSync(file).mtimeMs))

  if (existsSync(out) && statSync(out).mtimeMs > newest) return out

  await run(process.execPath, [TSX, GENERATOR, ...args, out], {
    cwd: WEB_ROOT,
    timeout: 5 * 60 * 1000,
    windowsHide: true,
  })

  if (!existsSync(out)) throw new Error(`The camera fixture ${out} was not written.`)
  return out
}
