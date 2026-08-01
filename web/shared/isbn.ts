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

/**
 * Pick the ISBN out of whatever the camera decoded this frame. Returns '' when
 * nothing in the list is a book barcode.
 */
export function pickIsbn(codes: string[]): string {
  for (const code of codes) {
    const digits = normaliseIsbn(code)
    if (isBooklandIsbn(digits)) return digits
    if (isValidIsbn10(digits)) {
      const converted = isbn10To13(digits)
      if (converted) return converted
    }
  }
  return ''
}
