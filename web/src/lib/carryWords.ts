/**
 * How the carry screens say a number, a stretch of shelf and a day.
 *
 * Pure, and here rather than in the panes, for the reason `lib/cascade.ts` is
 * pure: a sentence somebody reads standing at a bookcase is a claim, and a claim
 * that is only ever looked at is a claim nobody has checked. Two of these have
 * been wrong on paper already ("eight books" for one, and a stretch that named
 * the same author at both ends).
 *
 * ## Where the words stop
 *
 * At a hundred, and that is where the drawn design puts them: a top bar says
 * "53 books, five trips" and a card underneath says "Forty-five books, four
 * trips", so a headline count is digits and a card title is words. English
 * number words are mechanical up to ninety-nine and stop being so above it, so a
 * table that went further would be a table somebody has to keep true, which is
 * the objection `HomePane` raises against spelling out a catalogue's size. Past
 * it, digits with the thousands grouped.
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
 * Said over a walk whose two ends read the same string.
 *
 * Two pieces stand on one number, neither is named, and so their planks render
 * alike: `4A` to `4A`, which is a trip nobody can walk. The counts and the areas
 * behind it are right, and no wording the app could invent would tell the two
 * pieces apart, because there is nothing to tell apart until somebody names one.
 * So the sentence says what is true and what to do about it (#447).
 *
 * Here rather than in either pane because two screens draw this walk, and a note
 * on one of them and silence on the other is the same disagreement one level up.
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
 * The one line that turns "eight books" into something to act on without opening
 * it. Two names joined by "and" rather than by "to", because a run of two is not
 * a stretch; one name on its own for one book; and nothing at all when both ends
 * are the same author, since "Tartt to Tartt" is a sentence that has to be read
 * twice to learn nothing.
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
 * Why a book is not being carried, in one voice for the two screens that say
 * it.
 *
 * **The plan and the carry list are one job of work read twice**, minutes
 * apart, by the same person. #325 found them disagreeing: the plan counted a
 * checked out book among the ones it left alone and the list said nothing about
 * checked out books at all, so somebody told six were skipped went to work a
 * list that accounted for five and hunted for the sixth. The counts are settled
 * where they are read (`server/carry.ts`); the sentences are settled here, so
 * the two screens cannot drift into two spellings of one fact either.
 *
 * An unknown reason is said rather than dropped. A reason this table has not
 * heard of is still a book the rules will not touch, and swallowing it is the
 * omission the whole shape exists to prevent.
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
 * One group of books somebody left where they are, said in one line.
 *
 * **It names the rule, and that is the whole reason this sentence exists.**
 * Leaving books where they are answers the rules for those books and changes
 * nothing about the rules themselves, so the thing a person needs to know
 * afterwards is that something on that place still wants them elsewhere and is
 * theirs to change or to keep. A screen that only said "twenty-two set aside"
 * would leave them to work that out the next time they wondered.
 *
 * The rule is named as it was when it asked, because that is what was recorded.
 * A rule taken off a place since leaves the sentence saying what happened rather
 * than pointing at something that is not there.
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
 * When something happened, said the way somebody would say it.
 *
 * A weekday inside the last week, because "on Sunday" is how a person holds a
 * day that recent, and a date beyond it, because "on Tuesday" three weeks ago is
 * a puzzle rather than a memory. `today` is passed in rather than read, so the
 * sentence can be checked.
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
