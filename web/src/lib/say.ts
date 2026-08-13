/**
 * Numbers and dates, as this interface says them.
 *
 * Small, and here rather than in the screens that need them, because two
 * screens saying a number two ways is the kind of difference nobody notices
 * until both are on one page.
 */

/**
 * A number, grouped.
 *
 * The collection reaches four digits and 1204 reads as a year at the size these
 * are set. Written out rather than taken from `toLocaleString`, so the same
 * number is the same string wherever this runs, including in a test.
 */
export function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * A date, as short as it can be and still be a date.
 *
 * "4 Aug", and the year only when it is not this one: where a book has been is a
 * column of these down the side of a page, and a repeated year in every row is
 * four characters of noise on a phone. Something unparseable comes back empty
 * rather than as "Invalid Date", which is the app telling somebody about its own
 * internals.
 */
export function shortDate(value: string, now = new Date()): string {
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return ''

  const day = `${when.getDate()} ${MONTHS[when.getMonth()]}`
  return when.getFullYear() === now.getFullYear() ? day : `${day} ${when.getFullYear()}`
}
