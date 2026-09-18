/**
 * How the carry screens say a number, a stretch of shelf and a day.
 *
 * Pure, and here rather than in the panes: a sentence somebody reads
 * standing at a bookcase is a claim, and a claim that is only ever looked
 * at is a claim nobody has checked.
 *
 * Words stop at ninety-nine, the point past which English number words
 * stop being mechanical; beyond it, digits with the thousands grouped.
 */

import type { SetAside, SkipReason } from './api'

const UNITS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty',
  'sixty', 'seventy', 'eighty', 'ninety',
]

/** A number as this flow says it: written out while a person would write it. */
export function words(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return grouped(n)
  if (n < 20) return UNITS[n]!

  const tens = TENS[Math.floor(n / 10)]!
  const unit = n % 10
  return unit === 0 ? tens : `${tens}-${UNITS[unit]}`
}

/** The same, starting a sentence. */
export function said(n: number): string {
  const word = words(n)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** "Six books", the way a card title counts them. */
export function saidBooks(n: number): string {
  return `${said(n)} book${n === 1 ? '' : 's'}`
}

/**
 * Digits, grouped, because the collection reaches four and 1204 reads as a year.
 *
 * Written out rather than taken from `toLocaleString`, so the same number is the
 * same string wherever this runs.
 */
export function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** "8 books", "1 book". Digits, because these are counts of a real catalogue. */
export function plural(n: number, noun: string): string {
  return `${grouped(n)} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * Said over a walk whose two ends read the same string: two pieces stand
 * on one number, neither is named, so their planks render alike (`4A` to
 * `4A`) and no wording could tell them apart.
 *
 * Here rather than in either pane, since two screens draw this walk.
 */
export const sharedSaid = (label: string, at: number): string =>
  `Both ends read ${label}: two pieces stand at ${at} and neither is named. `
  + 'Name one of them to tell this trip apart.'

/** What a filing name is called on a spine, which is the surname on its own. */
export function surnameOf(filing: string): string {
  const name = filing.trim()
  if (!name) return ''
  const comma = name.indexOf(',')
  return comma === -1 ? name : name.slice(0, comma).trim()
}

/**
 * The stretch of shelf a trip covers, which is what somebody reads off the
 * spines while pulling books.
 *
 * Two names joined by "and" rather than "to", since a run of two is not a
 * stretch; one name alone for one book; and nothing when both ends are the
 * same author, since "Tartt to Tartt" reads twice to learn nothing.
 */
export function stretchOf(filings: readonly string[]): string {
  const names = filings.map(surnameOf).filter(Boolean)
  if (names.length === 0) return ''

  const first = names[0]!
  const last = names[names.length - 1]!
  if (names.length === 1 || first === last) return first
  if (names.length === 2) return `${first} and ${last}`
  return `${first} to ${last}`
}

/**
 * Why a book is not being carried, in one voice for the two screens that
 * say it. The counts are settled in `server/carry.ts`; the sentences are
 * settled here, so the two screens cannot drift into two spellings of one
 * fact.
 *
 * An unknown reason is said rather than dropped, since a reason this table
 * has not heard of is still a book the rules will not touch.
 */
const SKIP_SAID: Record<SkipReason, (n: number) => string> = {
  pinned: (n) => `${said(n)} you pinned.`,
  'checked-out': (n) => `${said(n)} checked out.`,
  withdrawn: (n) => `${said(n)} withdrawn from the collection.`,
  'never-placed': (n) => `${said(n)} never confirmed onto a bookcase.`,
}

export function skipSaid(
  skipped: readonly { reason: SkipReason; books: number }[],
): string {
  return skipped
    .map((one) => SKIP_SAID[one.reason]?.(one.books) ?? `${said(one.books)} left alone.`)
    .join(' ')
}

/** The same reasons as a word to put beside a book's name in a list. */
export const SKIP_WORD: Record<SkipReason, string> = {
  pinned: 'Pinned',
  'checked-out': 'Checked out',
  withdrawn: 'Withdrawn',
  'never-placed': 'Never placed',
}

/**
 * One group of books somebody left where they are, said in one line. Names
 * the rule, since leaving books where they are does not change the rule
 * itself, and something on that place may still want them elsewhere.
 *
 * The rule is named as it was when it asked, even if it has since been
 * taken off the place, since that is what was recorded.
 */
export function leftSaid(group: SetAside): string {
  const where = `${said(group.books)} on ${group.from} the rules want on ${group.to}`
  if (group.rules.length === 0) return `${where}.`
  return `${where}, asked for by ${group.rules.join(' and ')}.`
}

/** How many books are set aside altogether, which is what the card counts. */
export function leftBooks(groups: readonly SetAside[]): number {
  return groups.reduce((all, one) => all + one.books, 0)
}

/**
 * When something happened, said the way somebody would say it: a weekday
 * inside the last week, and a date beyond it. `today` is passed in rather
 * than read, so the sentence can be checked.
 */
export function whenSaid(day: string, today = new Date()): string {
  if (!day) return 'earlier'

  const at = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(at.getTime())) return 'earlier'

  const noon = new Date(`${today.toISOString().slice(0, 10)}T12:00:00Z`)
  const days = Math.round((noon.getTime() - at.getTime()) / 86_400_000)

  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) {
    return `on ${at.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}`
  }
  return `on ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
}
