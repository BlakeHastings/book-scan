/** Written out rather than taken from `toLocaleString`, so the same number is the same string wherever this runs, including in a test. */
export function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** "4 Aug", and the year only when it is not this one. Something unparseable comes back empty rather than as "Invalid Date". */
export function shortDate(value: string, now = new Date()): string {
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return ''

  const day = `${when.getDate()} ${MONTHS[when.getMonth()]}`
  return when.getFullYear() === now.getFullYear() ? day : `${day} ${when.getFullYear()}`
}
