import { describe, expect, it } from 'vitest'
import { isValidIsbn10, isValidIsbn13, isbn10To13, isBooklandIsbn, pickIsbn } from './isbn'

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
