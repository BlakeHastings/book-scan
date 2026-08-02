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
 * Letters OCR commonly returns in place of digits.
 *
 * Only ever applied inside a run that already looks like an ISBN, and the
 * result is always check-digit validated afterwards, so a wrong substitution
 * is discarded rather than believed. A real example from a 1986 paperback:
 * tesseract read "ISBN O-b7l-52543-3" for "ISBN 0-671-52543-3".
 *
 * X is deliberately absent: it is a legitimate ISBN-10 check character.
 */
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1',
  Z: '2', z: '2',
  E: '3',
  A: '4',
  S: '5', s: '5',
  b: '6', G: '6',
  T: '7',
  B: '8',
  g: '9', q: '9',
}

function repairDigits(value: string): string {
  return value.replace(/[^0-9Xx]/g, (char) => DIGIT_LOOKALIKES[char] ?? char)
}

export interface IsbnCandidate extends IsbnPair {
  /** True when the digits followed an explicit "ISBN" label on the page. */
  labelled: boolean
}

/**
 * Pull ISBNs out of OCR'd text.
 *
 * Two sources are trusted, and nothing else:
 *
 *   1. Digits following an explicit ISBN label. Books print one, and the
 *      label is what makes a bare 10-digit run interpretable at all.
 *   2. A 978/979 prefixed run anywhere in the text. Bookland prefixes are
 *      self-identifying, so these need no label.
 *
 * An unlabelled 10-digit run is deliberately NOT accepted. Roughly one in
 * eleven random 10-digit sequences satisfies the ISBN-10 check digit, and a
 * back cover is covered in long numbers: UPC digits, price add-ons, order
 * codes. Trusting those produced a confident, wrong ISBN on a real book.
 */
export function extractIsbnCandidates(text: string): IsbnCandidate[] {
  const source = (text ?? '').replace(/\s+/g, ' ')
  const found: IsbnCandidate[] = []

  const push = (raw: string, labelled: boolean) => {
    const pair = resolveIsbnPair(repairDigits(raw))
    if (!pair.isbn13) return
    if (found.some((c) => c.isbn13 === pair.isbn13)) return
    found.push({ ...pair, labelled })
  }

  // 1. Labelled. Take the run of digit-ish characters after the label; the
  //    separators books use (hyphen, space, dot) are stripped by repair.
  const labelled = /ISBN(?:[-\s]*1[03])?\s*[:.]?\s*([0-9OoQDIlLiZzEASsbGTBgqXx|!.\s-]{9,25})/gi
  for (const match of source.matchAll(labelled)) {
    const run = match[1] ?? ''
    // Try the longest sensible prefix first: a 13-digit ISBN with separators
    // can be up to ~17 characters, a 10-digit one up to ~13.
    const cleaned = repairDigits(run).replace(/[^0-9Xx]/g, '')
    if (cleaned.length >= 13) push(cleaned.slice(0, 13), true)
    if (cleaned.length >= 10) push(cleaned.slice(0, 10), true)
  }

  // 2. Bookland prefixed, label or not.
  for (const match of source.matchAll(/(97[89][\s-]?(?:\d[\s-]?){10})/g)) {
    push(match[1] ?? '', false)
  }

  // Labelled first: a label is far stronger evidence than a bare match.
  return [...found.filter((c) => c.labelled), ...found.filter((c) => !c.labelled)]
}

/** Convenience wrapper returning just the 13-digit forms, best first. */
export function extractIsbnsFromText(text: string): string[] {
  return extractIsbnCandidates(text).map((candidate) => candidate.isbn13)
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
/**
 * A run of one repeated digit is never a real ISBN, but some of them do
 * satisfy the check digit: 0000000000 sums to zero, which is divisible by 11.
 * OCR on a blank or noisy patch produces exactly this.
 */
function isDegenerate(digits: string): boolean {
  return digits.length > 0 && /^(.)\1*$/.test(digits.slice(0, -1))
}

export function resolveIsbnPair(value: string): IsbnPair {
  const digits = normaliseIsbn(value)
  if (isDegenerate(digits)) return NO_ISBN

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
