/**
 * What the first screen says when the collection has stopped being backed up.
 *
 * Here rather than in `HomePane` for the reason `say.ts` is here: this is four
 * sentences that have to stay true to four states the server distinguishes, and
 * a sentence written where it is drawn is a sentence nobody tests. The states
 * are `server/backup-watch.ts`'s and the wire carries them rather than the
 * words, so the server keeps deciding what is true and this file keeps deciding
 * how to say it.
 *
 * ## Nothing is said when everything is fine, and nothing when nothing is
 * watched
 *
 * Both come back as no card at all, and they are different silences. `fresh`
 * says nothing because the first screen is what needs a person and a backup
 * that happened last night does not. `unwatched` says nothing because there is
 * no claim to make: a development checkout has no collection worth protecting,
 * and an app that cried about one would teach everybody to scroll past the card
 * on the day it is real.
 *
 * The one thing this must never do is say something reassuring. There is no
 * "backups are fine" sentence in here, so there is nothing for a bug to print
 * over a disk that was never read.
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

/**
 * A number of days, in words up to fourteen and in digits after.
 *
 * Fourteen because that is how many backups are kept, so a gap wider than the
 * list is a different kind of sentence and reads better as a figure.
 */
function days(n: number): string {
  return NUMBERS[n] ?? String(n)
}

/**
 * How old the last proved backup is, said the way somebody would say it.
 *
 * Hours below a day, because "a day old" for something taken thirty hours ago
 * is the app rounding in the direction that makes it sound better, and this
 * card only ever exists because something rounded in that direction already.
 */
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

    /*
     * The runbook is blunt about this one and the wording follows it: "a dump
     * is a file, a backup is a file somebody has restored". A directory with
     * fourteen unrestored files in it looks more like protection than an empty
     * one does, which is what makes it the worse state to be in quietly.
     */
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
