/**
 * ISBN validation and conversion, ported from bookscan/recognize.py.
 *
 * The reason this matters more than it looks: most books carry a *second*
 * barcode next to the ISBN, an EAN-5 price add-on or a UPC. Scanning the wrong
 * one and looking it up gives a confident, wrong answer. Only 978 and 979
 * prefixes are books, so the scanner filters on that before it ever calls out.
 */

export function normaliseIsbn(value: string): string {
  return (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase()
}

export function isValidIsbn13(value: string): boolean {
  const digits = normaliseIsbn(value)
  if (digits.length !== 13 || !/^\d{13}$/.test(digits)) return false

  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3)
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(digits[12])
}

export function isValidIsbn10(value: string): boolean {
  const digits = normaliseIsbn(value)
  if (digits.length !== 10 || !/^\d{9}[\dX]$/.test(digits)) return false

  let sum = 0
  for (let i = 0; i < 9; i += 1) {
    sum += Number(digits[i]) * (10 - i)
  }
  sum += digits[9] === 'X' ? 10 : Number(digits[9])
  return sum % 11 === 0
}

export function isbn10To13(value: string): string {
  const digits = normaliseIsbn(value)
  if (!isValidIsbn10(digits)) return ''

  const core = `978${digits.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return `${core}${(10 - (sum % 10)) % 10}`
}

export function isbn13To10(value: string): string {
  const digits = normaliseIsbn(value)
  if (digits.length !== 13 || !digits.startsWith('978')) return ''

  const core = digits.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i += 1) {
    sum += Number(core[i]) * (10 - i)
  }
  const check = (11 - (sum % 11)) % 11
  return `${core}${check === 10 ? 'X' : check}`
}

/**
 * Pull ISBNs out of OCR'd text.
 *
 * Printed ISBNs carry hyphens and OCR sprinkles in spaces, so the patterns
 * tolerate a separator after every digit. That is deliberately loose, which
 * is safe only because every candidate is then check-digit validated. Without
 * that validation this would match half the numbers on a copyright page.
 */
export function extractIsbnsFromText(text: string): string[] {
  const found: string[] = []
  const push = (value: string) => {
    if (value && !found.includes(value)) found.push(value)
  }

  const isbn13 = /(97[89][\s-]?(?:\d[\s-]?){10})/g
  for (const match of (text ?? '').matchAll(isbn13)) {
    const candidate = normaliseIsbn(match[1] ?? '')
    if (isValidIsbn13(candidate)) push(candidate)
  }

  const isbn10 = /(?<!\d)((?:\d[\s-]?){9}[\dXx])(?!\d)/g
  for (const match of (text ?? '').matchAll(isbn10)) {
    const candidate = normaliseIsbn(match[1] ?? '')
    if (isValidIsbn10(candidate)) push(isbn10To13(candidate))
  }

  return found
}

/**
 * Is this barcode a book? EAN-13 codes starting 978 or 979 are Bookland;
 * anything else on the back cover is a price add-on or a UPC.
 */
export function isBooklandIsbn(value: string): boolean {
  const digits = normaliseIsbn(value)
  return (
    digits.length === 13 &&
    (digits.startsWith('978') || digits.startsWith('979')) &&
    isValidIsbn13(digits)
  )
}

export interface IsbnPair {
  /** Always the 13-digit form when the input was a book at all. */
  isbn13: string
  /** The 10-digit form. Empty for 979 ISBNs, which genuinely have none. */
  isbn10: string
}

const NO_ISBN: IsbnPair = { isbn13: '', isbn10: '' }

/**
 * Resolve both ISBN forms from whatever we were handed, validating each
 * candidate against the rules for its own length. This is the single place
 * that decides whether something is a book identifier, so barcode decoding,
 * OCR and manual entry cannot disagree.
 *
 * The trap this exists to close: a 13-digit code with a correct check digit
 * is not necessarily an ISBN. EAN-13 product barcodes use the identical
 * checksum, so `isValidIsbn13('4006381333931')` is true for a jar of coffee.
 * Only the 978/979 Bookland prefix separates the two categories, and a book's
 * back cover usually carries a second, non-Bookland barcode right next to the
 * ISBN. Length alone, or checksum alone, will happily pick the wrong one.
 *
 * The two forms are kept as separate data points rather than one canonical
 * value: catalogues index editions under whichever ISBN the edition was
 * issued with, so both are worth carrying and worth searching.
 */
export function resolveIsbnPair(value: string): IsbnPair {
  const digits = normaliseIsbn(value)

  if (digits.length === 13) {
    if (!isBooklandIsbn(digits)) return NO_ISBN
    // isbn13To10 returns '' for 979, which has no 10-digit equivalent.
    return { isbn13: digits, isbn10: isbn13To10(digits) }
  }

  if (digits.length === 10) {
    if (!isValidIsbn10(digits)) return NO_ISBN
    return { isbn13: isbn10To13(digits), isbn10: digits }
  }

  return NO_ISBN
}

/**
 * Pick the ISBN out of a list of decoded barcodes. Returns '' when nothing in
 * the list is a book barcode.
 */
export function pickIsbn(codes: string[]): string {
  for (const code of codes) {
    const { isbn13 } = resolveIsbnPair(code)
    if (isbn13) return isbn13
  }
  return ''
}
