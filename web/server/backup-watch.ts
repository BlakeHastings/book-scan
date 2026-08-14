/**
 * Whether there is a backup of the catalogue that somebody has proved restores.
 *
 * ## Why this exists at all
 *
 * The nightly backup has stopped twice, for two unrelated reasons, and both
 * times the only thing that knew was a log file (#239, #311). The preventive
 * layer is fine: the tool refuses to guess its connection, the wrapper writes
 * the reason it failed in plain words, and the reason was correct both times.
 * What was missing was anything that noticed.
 *
 * ## It asks about the result, never about the process
 *
 * **The task ran on both of the nights nobody found out about.** It started at
 * 03:30, failed in under a second, logged why, and exited non-zero, and a check
 * that asked "did the scheduled job run" would have been satisfied by both of
 * them. So nothing here reads a log, asks Task Scheduler anything, or cares
 * whether a process was started. It asks one question of the disk:
 *
 * > is there a dump in that directory, taken less than about a day ago, whose
 * > manifest says a verification restored it and found no differences?
 *
 * A broken process can fail to produce that. It cannot fake it.
 *
 * ## Three ways of not being fine, kept apart on purpose
 *
 * - **`unreachable`.** The directory could not be read. The dumps live on a
 *   second physical disk, which is the right place for them and is also a thing
 *   that can be unplugged, so "I could not look" must never come back as a pass.
 *   It is reported as its own answer rather than folded into "no backups", which
 *   would say the collection is unprotected when the truth is that nobody knows.
 * - **`unverified`.** There are dumps and not one of them carries a passed
 *   verification. This is the state the runbook calls worse than nothing,
 *   because a directory with fourteen files in it looks exactly like protection:
 *   "a dump is a file, a backup is a file somebody has restored".
 * - **`stale`.** There is a verified dump and it is too old. This is what both
 *   incidents actually looked like on disk.
 *
 * ## It never writes, and it never opens the catalogue
 *
 * Two reads and nothing else: the names in the directory, and the manifests
 * beside the newest few dumps. No connection is opened, no file is created,
 * moved or swept, and no retention decision is made here. `E:\book-scan-backups`
 * is in the out-of-bounds table in AGENTS.md along with the catalogue itself,
 * and a checker that tidied up what it found there would be the second thing in
 * this repository allowed to delete a backup.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dumpTimestamp, manifestFileName, type Manifest } from './backup'

/**
 * How old the newest verified dump is allowed to be, in hours.
 *
 * A day and two hours. The schedule is nightly, so a check made just before
 * tonight's run is legitimately looking at something almost twenty-four hours
 * old, and the task carries `-StartWhenAvailable`, which runs a missed
 * occurrence once a sleeping desktop is back rather than skipping the day. Two
 * hours of slack is what keeps a run that started late off this screen. It is
 * deliberately not a day exactly: an alarm that fires on an ordinary Tuesday is
 * an alarm somebody learns to scroll past, which is the failure this is for.
 */
export const BACKUP_AGE_LIMIT_HOURS = 26

/**
 * How far back to look for a verified dump.
 *
 * Retention keeps fourteen, so this only ever bites in a directory nothing has
 * swept. A verified dump thirty-three dumps down is older than every answer
 * this reports anyway, so stopping is not a different verdict, only less work.
 */
const MOST_TO_OPEN = 32

/** One dump on the disk, as this check reports it. */
export interface WatchedDump {
  /** The dump's own filename. */
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
 * constant, so a test can put a directory at any age without touching a file's
 * timestamps, and so the same directory can be asked about twice.
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
   * Newest first, and dated from the filename rather than from the file's
   * timestamp. The runbook is explicit about why retention does the same: a
   * directory that has been copied, restored or synchronised from somewhere
   * else has mtimes saying when the copy happened and nothing about when the
   * catalogue was read. A `.dump.part` from an interrupted run does not match
   * the pattern, so it is not a dump here either, which is right: nothing will
   * restore from one.
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
 * Missing and malformed collapse into the same answer deliberately. Three
 * shapes of this file exist on the owner's disk already, written by three
 * revisions of the tool, and the only field read here has been in every one of
 * them; anything this cannot parse is a file that cannot prove a restore, which
 * is what the caller is asking.
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
