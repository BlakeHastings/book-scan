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
