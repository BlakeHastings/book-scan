import { describe, expect, it } from 'vitest'
import {
  isValidIsbn10, isValidIsbn13, isbn10To13, isbn13To10, isBooklandIsbn,
  pickIsbn, resolveIsbnPair, extractIsbnCandidates, extractIsbnsFromText,
} from './isbn'

describe('resolveIsbnPair', () => {
  it('returns both forms from a 13-digit Bookland ISBN', () => {
    expect(resolveIsbnPair('9780441013593'))
      .toEqual({ isbn13: '9780441013593', isbn10: '0441013597' })
  })

  it('returns both forms from a 10-digit ISBN', () => {
    expect(resolveIsbnPair('0441013597'))
      .toEqual({ isbn13: '9780441013593', isbn10: '0441013597' })
  })

  it('agrees with itself in both directions', () => {
    const fromThirteen = resolveIsbnPair('9780441013593')
    const fromTen = resolveIsbnPair('0441013597')
    expect(fromThirteen).toEqual(fromTen)
  })

  it('rejects a plain EAN-13 product code that is not a book', () => {
    // 4006381333931 has a perfectly valid EAN-13 check digit, so a bare
    // "is this a valid ISBN-13" test says yes. It is not a book. Only the
    // 978/979 Bookland prefix separates the two categories.
    expect(isValidIsbn13('4006381333931')).toBe(true)
    expect(resolveIsbnPair('4006381333931')).toEqual({ isbn13: '', isbn10: '' })
  })

  it('leaves isbn10 empty for a 979 ISBN, which has no 10-digit form', () => {
    const pair = resolveIsbnPair('9791234567896')
    expect(pair.isbn13).toBe('9791234567896')
    expect(pair.isbn10).toBe('')
  })

  it('rejects a bad check digit in either length', () => {
    expect(resolveIsbnPair('9780441013594')).toEqual({ isbn13: '', isbn10: '' })
    expect(resolveIsbnPair('0441013598')).toEqual({ isbn13: '', isbn10: '' })
  })

  it('rejects lengths that are neither 10 nor 13', () => {
    expect(resolveIsbnPair('51999')).toEqual({ isbn13: '', isbn10: '' })
    expect(resolveIsbnPair('')).toEqual({ isbn13: '', isbn10: '' })
  })

  it('tolerates hyphens and spaces in either form', () => {
    expect(resolveIsbnPair('978-0-441-01359-3').isbn13).toBe('9780441013593')
    expect(resolveIsbnPair('0-441-01359-7').isbn13).toBe('9780441013593')
  })

  it('handles the X check digit on an ISBN-10', () => {
    const pair = resolveIsbnPair('080442957X')
    expect(pair.isbn10).toBe('080442957X')
    expect(isValidIsbn13(pair.isbn13)).toBe(true)
    expect(isbn13To10(pair.isbn13)).toBe('080442957X')
  })
})

describe('ISBN validation', () => {
  it('accepts real ISBN-13s', () => {
    expect(isValidIsbn13('9780441013593')).toBe(true) // Dune
    expect(isValidIsbn13('978-0-441-01359-3')).toBe(true)
  })

  it('rejects a bad check digit', () => {
    expect(isValidIsbn13('9780441013594')).toBe(false)
  })

  it('accepts ISBN-10 including the X check digit', () => {
    expect(isValidIsbn10('0441013597')).toBe(true)
    expect(isValidIsbn10('080442957X')).toBe(true)
  })

  it('converts 10 to 13', () => {
    expect(isbn10To13('0441013597')).toBe('9780441013593')
  })
})

describe('pickIsbn', () => {
  it('ignores the EAN-5 price add-on that sits beside the ISBN', () => {
    // This is the failure that matters: scanning the price barcode and
    // looking it up returns a confident, wrong book.
    expect(pickIsbn(['51999'])).toBe('')
  })

  it('ignores a non-Bookland EAN-13', () => {
    expect(isBooklandIsbn('4006381333931')).toBe(false)
    expect(pickIsbn(['4006381333931'])).toBe('')
  })

  it('picks the book barcode out of a mixed frame', () => {
    expect(pickIsbn(['51999', '9780441013593'])).toBe('9780441013593')
  })

  it('upgrades a bare ISBN-10 to 13', () => {
    expect(pickIsbn(['0441013597'])).toBe('9780441013593')
  })
})

describe('extractIsbnCandidates, from real OCR output', () => {
  const DARK_ANGEL = '9780671525439' // ISBN 0-671-52543-3

  it('rejects an unlabelled 10-digit run', () => {
    // This is the bug that shipped a wrong book. Roughly one in eleven random
    // 10-digit runs passes the ISBN-10 check digit, and a back cover is full
    // of long numbers. 5176714485 is a real false positive taken from a photo
    // of a UPC barcode; it validates, and it is not an ISBN.
    expect(isValidIsbn10('5176714485')).toBe(true)
    expect(extractIsbnsFromText('0 76714 00450 52543 5176714485')).toHaveLength(0)
  })

  it('reads a labelled ISBN-10 through OCR letter confusions', () => {
    // Verbatim from tesseract on the failing photo: O for 0, b for 6, l for 1.
    expect(extractIsbnsFromText('ISBN O-b7l-52543-3')).toContain(DARK_ANGEL)
  })

  it('reads the same label when OCR gets it right', () => {
    expect(extractIsbnsFromText('ISBN 0-671-52543-3')).toContain(DARK_ANGEL)
  })

  it('still accepts an unlabelled Bookland run, which is self-identifying', () => {
    expect(extractIsbnsFromText('junk 9780441013593 junk')).toContain('9780441013593')
  })

  it('prefers a labelled ISBN over an unlabelled Bookland one', () => {
    const found = extractIsbnCandidates('9780441013593 ... ISBN 0-671-52543-3')
    expect(found[0]!.isbn13).toBe(DARK_ANGEL)
    expect(found[0]!.labelled).toBe(true)
  })

  it('does not repair its way into a wrong answer', () => {
    // Letter substitution is only safe because the check digit still has to
    // pass afterwards. Garbage after a label must not produce an ISBN.
    expect(extractIsbnsFromText('ISBN 1-234-56789-0')).toHaveLength(0)
  })

  it('rejects a run of one repeated digit', () => {
    // 0000000000 satisfies the ISBN-10 check digit (zero is divisible by 11),
    // and OCR on a blank patch produces exactly that.
    expect(extractIsbnsFromText('ISBN OOOO-OOO-OOOOO-O')).toHaveLength(0)
    expect(resolveIsbnPair('0000000000')).toEqual({ isbn13: '', isbn10: '' })
  })

  it('ignores the digits printed under a UPC barcode', () => {
    expect(extractIsbnsFromText('0 76714 00450 4')).toHaveLength(0)
  })
})
