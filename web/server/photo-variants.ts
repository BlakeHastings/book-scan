/**
 * Smaller copies of the photographs, made the first time a width is asked for
 * and kept on disk beside the cover directory rather than inside it.
 *
 * Beside rather than inside because the cover directory is the photographs and
 * nothing else: the backup mirrors it file for file, and everything here can be
 * thrown away and made again. Deleting the whole directory is always safe.
 */

import { mkdirSync, renameSync, rmSync, type Stats } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'

/** Where the copies of `coverDir`'s photographs are kept: a sibling, never a child. */
export function variantDirFor(coverDir: string): string {
  return join(dirname(coverDir), `${basename(coverDir)}-variants`)
}

/**
 * A photograph's filename as something safe to name a directory after, or null.
 * The route has already refused separators; a name starting with a dot is refused
 * here too, since `..` is a bare filename that is also the parent directory.
 */
export function variantKey(name: string): string | null {
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\')) return null
  return name
}

/**
 * The copy's own filename carries the source file's size and modification time,
 * so a photograph replaced under the same name can never be answered with a copy
 * of what was there before.
 */
function copyPath(dir: string, name: string, width: number, source: Stats): string {
  return join(dir, name, `w${width}-${source.size.toString(16)}-${Math.floor(source.mtimeMs).toString(16)}.jpg`)
}

/** One resize per copy at a time, however many requests arrive for it together. */
const making = new Map<string, Promise<Buffer>>()

export async function variantOf(
  dir: string,
  file: string,
  name: string,
  width: number,
  source: Stats,
): Promise<Buffer> {
  const path = copyPath(dir, name, width, source)
  try {
    return await readFile(path)
  } catch {
    // Not made yet.
  }

  const already = making.get(path)
  if (already) return already

  const made = (async () => {
    const body = await sharp(file)
      // Applies a camera's orientation tag before the tag is dropped with the
      // rest of the metadata, so a copy stands the way the original displays.
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: width >= 1280 ? 80 : 72, mozjpeg: true })
      .toBuffer()
    // A copy that cannot be written is still a good answer to this request.
    try {
      mkdirSync(dirname(path), { recursive: true })
      const partial = `${path}.${process.pid}.partial`
      await writeFile(partial, body)
      renameSync(partial, path)
    } catch {
      // Read-only disk, or full: the next request resizes again.
    }
    return body
  })()
  making.set(path, made)
  try {
    return await made
  } finally {
    making.delete(path)
  }
}

/** Every copy of one photograph, for when the photograph itself is deleted. */
export function forgetVariants(dir: string, name: string): void {
  const key = variantKey(name)
  if (!key) return
  rmSync(join(dir, key), { recursive: true, force: true })
}
