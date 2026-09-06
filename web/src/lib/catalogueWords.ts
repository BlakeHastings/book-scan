/**
 * What the app says about the catalogues it asks, and where it says it (#348).
 *
 * Here rather than in the two screens that draw it, for `driftWords.ts`'s
 * reason: these are sentences that have to stay true to counters the server
 * keeps, and a sentence written where it is drawn is a sentence nobody tests.
 * The server keeps deciding what is true; this file keeps deciding how to say
 * it.
 *
 * ## Why there is a screen at all, when `/api/health` already answers
 *
 * Because #519 settled the general form of this question and the answer applies
 * here too. A startup log line could not be the reader for the placement
 * projection, and not only because nobody reads logs: it is printed once, and
 * the thing it reports goes wrong while the process is running. `/api/health`
 * was the reader it got.
 *
 * A catalogue going quiet has the same shape and one more turn of the screw.
 * The log line is printed the first time a source goes quiet and then not
 * again, on purpose, because a line per book is a line nobody reads. And since
 * #521 `/api/health` is behind the gate, so reading it is a signed-in `curl`
 * from a terminal. The person this is about owns the books, holds a phone, and
 * will never type that command. **The counters existed and nobody could see
 * them**, which is one storey up from the defect they were built to end.
 *
 * ## Two screens, and which fact goes on which
 *
 * #504's split, applied to a different pair of facts. There the news was a
 * count on the first screen and the names were the books, on the screen where
 * books live. Here the news is that a catalogue has answered nothing, and the
 * "names" are the catalogues themselves, so they belong on the screen where the
 * app's own arrangements are, which is Settings, and not on a shelf. A quiet
 * catalogue is not a fact about the collection, and nobody resolves one by
 * carrying a book.
 *
 * ## The first screen carries refusals and not failures
 *
 * This is the line worth arguing rather than defaulting to a card, and the
 * split between `declined` and `failed` is what makes it drawable.
 *
 * A refusal is a standing state. 401, 403 and 429 will be the same answer for
 * the next book and the one after, because they are about this application
 * rather than about the afternoon, and something a person changes is what ends
 * them. Google Books has refused every request in the life of the real
 * catalogue. That belongs in front of the owner.
 *
 * A failure is weather. A timeout or an unreachable host ends on its own, often
 * before he has finished the shelf, and a card about it would be a card he
 * learns to scroll past, which is exactly how the day it is real gets missed.
 * So failures are counted, reported in Settings, and not put on the first
 * screen. The same judgement the server already makes when it leaves `ok` true
 * for a quiet catalogue: somebody can still catalogue a book.
 *
 * There is no reassuring sentence here either. A day when every catalogue is
 * answering draws no card, for `backupWords.ts`'s reason: a line saying
 * everything is fine is a line a bug can print over a check that never ran.
 */

import type { LookupStandings, SourceStanding } from './api'
import { plural } from './carryWords'

/** The bad news, and why it matters. */
export interface CatalogueTrouble {
  title: string
  said: string
}

/** One catalogue's standing, said in a line. */
export interface CatalogueRow {
  source: string
  said: string
}

/** Everything the Settings card draws. */
export interface CatalogueRoll {
  said: string
  keyed: string
  rows: CatalogueRow[]
}

/**
 * A catalogue that was asked, answered nothing, and refused at least once.
 *
 * The three conditions together, and each is load-bearing. Asked, because a
 * catalogue nobody has consulted owes nothing. Answered nothing, because a
 * source that is contributing and also having a bad morning is not news.
 * Refused, because that is the half of "did not answer" that will still be true
 * tomorrow.
 */
function refusing(one: SourceStanding): boolean {
  return one.asked > 0 && one.answered === 0 && one.declined > 0
}

/**
 * The card on the first screen: that a catalogue has answered nothing, and
 * where to look.
 *
 * Null for a read that has not answered and null for an ordinary day, and those
 * are different silences: no refusal is a working afternoon, and a request that
 * never came back is not something to write a sentence from.
 *
 * **Every refusing catalogue is named, not the first one.** A report that reads
 * as complete and is not is the defect this whole issue is about, and it would
 * be a strange way to fix it to write a card that mentions one of two.
 */
export function catalogueTrouble(lookups: LookupStandings | null): CatalogueTrouble | null {
  if (!lookups) return null

  const quiet = (lookups.sources ?? []).filter(refusing)
  if (quiet.length === 0) return null

  const first = quiet[0]!
  const others = quiet.slice(1).map((one) => one.source)
  const unkeyed = quiet.some((one) => one.source === 'Google Books')
    && !lookups.googleBooksKeyConfigured

  return {
    title:
      `${first.source} has described none of the ` +
      `${plural(first.asked, 'book')} you have looked up`,
    said:
      `${others.length > 0 ? `${alsoQuiet(others)} the same. ` : ''}`
      + `${first.source} is turning the request away rather than failing to `
      + 'answer it, so it will keep doing that until something changes where '
      + `this app runs.${unkeyed
        ? ' Google Books is being asked without a key, which leaves it in a '
          + 'pool everybody shares, and that pool is used up.'
        : ''} `
      + 'Nothing you have catalogued is wrong: those books were described by '
      + 'the catalogues that did answer. What each one has done is in Settings, '
      + 'under "Where your books are described from".',
  }
}

/** "Google Books and K10plus are", "K10plus is". */
function alsoQuiet(names: string[]): string {
  if (names.length === 1) return `${names[0]} is doing`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are doing`
}

/**
 * What one catalogue has done, in a line, with every number said out loud.
 *
 * **Including the noughts**, which is the rule this whole issue produced: an
 * absent number reads as "nothing to report" and means the opposite. A
 * catalogue at nought everywhere is the sentence about never having been asked,
 * not a blank.
 */
function standing(one: SourceStanding): string {
  if (one.asked === 0) {
    return one.skipped > 0
      ? `Wanted ${plural(one.skipped, 'time')} and not asked, to stay inside `
        + 'the rate this library allows.'
      : 'Not asked yet.'
  }

  const held = `Asked about ${plural(one.asked, 'book')}: `
    + `described ${one.held}, had no record of ${one.noRecord}, `
    + `turned away ${one.declined}, failed on ${one.failed}.`

  return one.skipped > 0
    ? `${held} Wanted ${plural(one.skipped, 'more time')} and not asked, to `
      + 'stay inside the rate this library allows.'
    : held
}

/**
 * The Settings card: every catalogue, and what each has done.
 *
 * Every catalogue every time, including the ones that have done nothing, which
 * is the same rule the server's report follows and for the same reason. This
 * card is the only place in the app where a catalogue that was never asked is
 * visibly different from a catalogue that answered and had no record, and that
 * difference is the issue.
 *
 * It says the counts reset, because they do: they live in the server process
 * and a restart empties them. A card that let somebody read "asked 0" as
 * "nothing has ever been asked" would be inventing the ambiguity it exists to
 * remove.
 */
export function catalogueRoll(lookups: LookupStandings | null): CatalogueRoll | null {
  if (!lookups) return null

  return {
    said:
      'Every book you scan is looked up in these, in this order, and the '
      + 'answers merged. One of them being quiet does not stop a book being '
      + 'catalogued; it means that book was described by fewer of them. These '
      + 'counts start again each time the app is restarted, so a nought here is '
      + 'about today rather than about ever.',
    keyed: lookups.googleBooksKeyConfigured
      ? 'Google Books is being asked with a key.'
      : 'Google Books is being asked without a key, so it falls back to a pool '
        + 'everybody shares. Setting a key is done where the server runs, not here.',
    rows: (lookups.sources ?? []).map((one) => ({
      source: one.source,
      said: standing(one),
    })),
  }
}
