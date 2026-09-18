/**
 * Whether there is a backup of the catalogue that somebody has proved
 * restores.
 *
 * Asks about the result, never the process: whether there is a dump in the
 * directory, taken recently, whose manifest says a verification restored it
 * and found no differences. A broken process can fail to produce that; it
 * cannot fake it.
 *
 * `unreachable` (the directory could not be read) is kept apart from `none`
 * or `unverified`, since a disk that could not be checked must never be
 * reported as either safe or unprotected.
 *
 * Read-only: two reads, the directory listing and the manifests beside the
 * newest few dumps, nothing else.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dumpTimestamp, manifestFileName, type Manifest } from './backup'

/**
 * How old the newest verified dump is allowed to be, in hours: a day plus two
 * hours of slack. The task carries `-StartWhenAvailable`, so a run can be
 * legitimately hours late; deliberately not exactly a day, so an alarm does
 * not fire on every ordinary run.
 */
export const BACKUP_AGE_LIMIT_HOURS = 26

/**
 * How far back to look for a verified dump. Retention keeps fourteen, so this
 * only bites in a directory nothing has swept; stopping here is not a
 * different verdict, only less work.
 */
const MOST_TO_OPEN = 32

/** One dump on the disk, as this check reports it. */
export interface WatchedDump {
  dump: string
  /** When the catalogue was read, ISO-8601 UTC, out of the filename. */
  takenAt: string
}

export type BackupState =
  /** No directory was given, so nothing is being watched and nothing is claimed. */
  | 'unwatched'
  /** The directory could not be read. Not a pass and not a failure: nobody knows. */
  | 'unreachable'
  /** The directory is readable and holds no dump at all. */
  | 'none'
  /** There are dumps and none of them has been restored to prove it. */
  | 'unverified'
  /** The newest verified dump is older than the limit. */
  | 'stale'
  /** There is a verified dump newer than the limit. */
  | 'fresh'

export interface BackupWatch {
  state: BackupState
  /** Where it looked. Empty when nothing is watched. */
  where: string
  /** The age a verified dump is allowed to reach, in hours. */
  limitHours: number
  /** Why the directory could not be read. Only on `unreachable`. */
  why?: string
  /** The newest dump on the disk, whatever its verification says. */
  newest?: WatchedDump
  /** The newest dump a verification passed on. */
  verified?: WatchedDump
  /** How old `verified` is, in whole hours. Negative is not possible to report. */
  ageHours?: number
}

/**
 * Look, and say what is there.
 *
 * `now` and `limitHours` are arguments rather than reads of the clock and the
 * constant, so a test can put a directory at any age without touching file
 * timestamps.
 */
export async function watchBackups(
  dir: string,
  now: Date = new Date(),
  limitHours: number = BACKUP_AGE_LIMIT_HOURS,
): Promise<BackupWatch> {
  if (!dir) return { state: 'unwatched', where: '', limitHours }

  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    return { state: 'unreachable', where: dir, limitHours, why: reasonOf(error) }
  }

  /*
   * Newest first, dated from the filename rather than the file's timestamp: a
   * directory copied, restored or synchronised from elsewhere has mtimes
   * saying when the copy happened, not when the catalogue was read. A
   * `.dump.part` from an interrupted run does not match the pattern either,
   * which is right: nothing will restore from one.
   */
  const dumps = names
    .map((name) => ({ name, takenAt: dumpTimestamp(name) }))
    .filter((one): one is { name: string; takenAt: Date } => one.takenAt !== undefined)
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())

  if (dumps.length === 0) return { state: 'none', where: dir, limitHours }

  const newest = told(dumps[0]!)

  let verified: WatchedDump | undefined
  let verifiedAt = 0
  for (const one of dumps.slice(0, MOST_TO_OPEN)) {
    const manifest = await readManifest(dir, one.name)
    // Absent, unparseable, half-written or verified and failing all come out
    // here as the same thing, because they are: no proof this dump restores.
    if (manifest?.verified?.ok !== true) continue
    verified = told(one)
    verifiedAt = one.takenAt.getTime()
    break
  }

  if (!verified) return { state: 'unverified', where: dir, limitHours, newest }

  const ageHours = Math.floor((now.getTime() - verifiedAt) / 3_600_000)
  return {
    state: ageHours >= limitHours ? 'stale' : 'fresh',
    where: dir,
    limitHours,
    newest,
    verified,
    ageHours,
  }
}

function told(one: { name: string; takenAt: Date }): WatchedDump {
  return { dump: one.name, takenAt: one.takenAt.toISOString() }
}

/**
 * The manifest beside a dump, or nothing at all.
 *
 * Missing and malformed collapse into the same answer deliberately: anything
 * that cannot be parsed is a file that cannot prove a restore, which is what
 * the caller is asking.
 */
async function readManifest(dir: string, dump: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, manifestFileName(dump)), 'utf8')) as Manifest
  } catch {
    return undefined
  }
}

/** Why a directory would not open, in words rather than in a code. */
function reasonOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return 'there is no such folder'
  if (code === 'ENOTDIR') return 'that is not a folder'
  if (code === 'EACCES' || code === 'EPERM') return 'it could not be opened'
  return code ? `it could not be read (${code})` : 'it could not be read'
}
