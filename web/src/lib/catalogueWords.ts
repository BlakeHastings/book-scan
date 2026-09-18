/**
 * What the app says about the catalogues it asks, and where it says it.
 *
 * Here rather than in the two screens that draw it: these are sentences
 * that have to stay true to counters the server keeps, and a sentence
 * written where it is drawn is a sentence nobody tests.
 *
 * A refusal (`declined`) is a standing state: the same catalogue will
 * refuse the next book too, until something changes where the app runs, so
 * it belongs on the first screen. A failure (`failed`) is weather, often
 * gone before the next book, so it is only counted in Settings.
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
 * Each condition matters: asked (a catalogue never consulted owes nothing),
 * answered nothing (a source having a bad morning while still contributing
 * is not news), and refused (the part of "did not answer" still true
 * tomorrow).
 */
function refusing(one: SourceStanding): boolean {
  return one.asked > 0 && one.answered === 0 && one.declined > 0
}

/**
 * The card on the first screen: that a catalogue has answered nothing, and
 * where to look.
 *
 * Null both for a read that has not answered and for an ordinary day: no
 * refusal is a working afternoon, and a request that never came back is not
 * something to write a sentence from.
 *
 * Every refusing catalogue is named, not just the first.
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
 * What one catalogue has done, in a line, with every number said out loud,
 * including the noughts: an absent number would read as "nothing to
 * report" and mean the opposite.
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
 * Every catalogue every time, including ones that have done nothing: this
 * is the only place a catalogue that was never asked is visibly different
 * from one that answered and had no record.
 *
 * The counts reset on a server restart, so "asked 0" means today, not ever.
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
