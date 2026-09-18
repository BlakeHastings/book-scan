/**
 * `fresh` and `unwatched` both come back as no card at all, and they are different silences:
 * `fresh` needs no action, `unwatched` has no collection worth protecting. This must never say
 * something reassuring, so there is no "backups are fine" sentence for a bug to print over a
 * disk that was never read.
 */

import type { BackupWatch } from './api'
import { shortDate } from './say'

/** The bad news, and why it matters, or nothing to say. */
export interface BackupTrouble {
  title: string
  said: string
}

const NUMBERS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
]

/** In words up to fourteen, the number of backups kept, and in digits after. */
function days(n: number): string {
  return NUMBERS[n] ?? String(n)
}

/** Hours below a day, since "a day old" for something taken thirty hours ago rounds in the direction that makes it sound better. */
function aged(hours: number): string {
  if (hours < 48) return `${Math.floor(hours)} hours old`
  return `${days(Math.floor(hours / 24))} days old`
}

export function troubleWith(watch: BackupWatch | null, now = new Date()): BackupTrouble | null {
  if (!watch) return null

  switch (watch.state) {
    case 'unwatched':
    case 'fresh':
      return null

    case 'unreachable':
      return {
        title: 'The backups cannot be read',
        said:
          'Where the backups are kept did not answer, so nothing can say ' +
          'whether there is a copy of the collection. If it is a disk, it may ' +
          'be unplugged.',
      }

    case 'none':
      return {
        title: 'Nothing has been backed up',
        said:
          'There is no copy of the collection where the backups are kept, and ' +
          'it exists in one place only.',
      }

    // Vocabulary: a dump is a file, a backup is a file somebody has restored.
    case 'unverified':
      return {
        title: 'No backup has been proved',
        said:
          'There are copies of the collection and not one of them has been ' +
          'restored to prove it works. A copy nobody has restored is a guess.',
      }

    case 'stale':
    default: {
      const when = watch.verified ? shortDate(watch.verified.takenAt, now) : ''
      return {
        title: `The last proved backup is ${aged(watch.ageHours ?? 0)}`,
        said:
          `${when ? `It was taken on ${when}. ` : ''}The collection is added to ` +
          'most days, so everything since then exists in one place only.',
      }
    }
  }
}
