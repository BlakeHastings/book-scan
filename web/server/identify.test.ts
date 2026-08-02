/**
 * These exercise the real zbar and tesseract pipelines against generated
 * covers. They are slower than the rest of the suite and that is the point:
 * the live browser scanner passed its unit tests and still could not read a
 * book, because nothing tested it against an actual image.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { backCover, barcodePng, frontCover, glossy } from './fixtures'
import { decodeBarcodes, identify, pickTitle, shutdownOcr } from './identify'
import { extractIsbnsFromText, isbn13To10 } from '../shared/isbn'

const bwipBarcode = (isbn: string) => barcodePng(isbn, 4)

const ISBN = '9780441013593' // Dune

afterAll(async () => {
  await shutdownOcr()
})

describe('barcode decoding', () => {
  it('reads a clean back cover', async () => {
    expect(await decodeBarcodes(await backCover(ISBN))).toContain(ISBN)
  }, 30_000)

  it('reads a glossy, low-contrast cover', async () => {
    // The threshold and normalise variants exist for exactly this.
    const codes = await decodeBarcodes(await glossy(await backCover(ISBN)))
    expect(codes).toContain(ISBN)
  }, 30_000)

  it('reads a cover photographed sideways', async () => {
    const codes = await decodeBarcodes(await backCover(ISBN, { rotate: 90 }))
    expect(codes).toContain(ISBN)
  }, 30_000)

  it('finds the ISBN even with a price add-on beside it', async () => {
    const codes = await decodeBarcodes(await backCover(ISBN, { priceAddOn: true }))
    expect(codes).toContain(ISBN)
  }, 30_000)

  it('returns nothing for a cover with no barcode', async () => {
    const codes = await decodeBarcodes(
      await backCover(ISBN, { barcode: false, printedIsbn: false }),
    )
    expect(codes).toHaveLength(0)
  }, 30_000)
})

describe('identify', () => {
  it('prefers the barcode and reports it as the source', async () => {
    const result = await identify(await backCover(ISBN), { ocrEnabled: false })
    expect(result.isbn13).toBe(ISBN)
    expect(result.isbn10).toBe(isbn13To10(ISBN))
    expect(result.source).toBe('barcode')
  }, 30_000)

  it('falls back to OCR of the printed ISBN when there is no barcode', async () => {
    // This is the case the live browser scanner could never handle.
    const result = await identify(
      await backCover(ISBN, { barcode: false, printedIsbn: true }),
    )
    expect(result.isbn13).toBe(ISBN)
    expect(result.source).toBe('ocr')
  }, 120_000)

  it('reports honestly when a photo carries no ISBN at all', async () => {
    const result = await identify(
      await backCover(ISBN, { barcode: false, printedIsbn: false }),
    )
    expect(result.isbn13).toBe('')
    expect(result.source).toBe('')
    expect(result.notes.join(' ')).toContain('No ISBN found')
  }, 120_000)

  it('guesses a title from the front cover by glyph size', async () => {
    const result = await identify(await frontCover('DUNE', 'Frank Herbert'), {
      wantTitle: true,
    })
    expect(result.titleGuess.toUpperCase()).toContain('DUNE')
  }, 120_000)
})

describe('barcode category', () => {
  it('does not accept a non-book EAN-13 as an ISBN', async () => {
    // The regression this guards: fromBarcodes used to test isValidIsbn13,
    // which a plain retail EAN-13 passes, because the checksum is identical.
    // A back cover often carries exactly such a barcode next to the ISBN.
    const png = await bwipBarcode('4006381333931')
    const result = await identify(png, { ocrEnabled: false })
    expect(result.isbn13).toBe('')
    expect(result.source).toBe('')
    expect(result.notes.join(' ')).toContain('price code')
  }, 30_000)

  it('still accepts a 979 Bookland ISBN', async () => {
    const png = await bwipBarcode('9791234567896')
    const result = await identify(png, { ocrEnabled: false })
    expect(result.isbn13).toBe('9791234567896')
    // 979 has no 10-digit equivalent, so this is correctly empty rather than
    // a wrong value.
    expect(result.isbn10).toBe('')
  }, 30_000)

  it('reports both forms for a 978 ISBN', async () => {
    const result = await identify(await backCover(ISBN), { ocrEnabled: false })
    expect(result.isbn13).toBe('9780441013593')
    expect(result.isbn10).toBe('0441013597')
  }, 30_000)
})

describe('pickTitle', () => {
  it('prefers the largest line', () => {
    expect(pickTitle([
      { text: 'Frank Herbert', height: 40, words: 2 },
      { text: 'DUNE', height: 120, words: 1 },
    ])).toBe('DUNE')
  })

  it('ignores cover boilerplate that is never a title', () => {
    expect(pickTitle([
      { text: 'A NOVEL', height: 200, words: 2 },
      { text: 'NEW YORK TIMES BESTSELLER', height: 180, words: 4 },
      { text: 'Real Title', height: 100, words: 2 },
    ])).toBe('Real Title')
  })

  it('does not let one huge stray letter beat a real title', () => {
    expect(pickTitle([
      { text: 'X', height: 110, words: 1 },
      { text: 'The Left Hand of Darkness', height: 100, words: 5 },
    ])).toBe('The Left Hand of Darkness')
  })
})

describe('extractIsbnsFromText', () => {
  it('reads a hyphenated printed ISBN', () => {
    expect(extractIsbnsFromText('ISBN 978-0-441-01359-3')).toContain(ISBN)
  })

  it('tolerates the spaces OCR sprinkles in', () => {
    expect(extractIsbnsFromText('ISBN 978 0 441 01359 3')).toContain(ISBN)
  })

  it('upgrades a printed ISBN-10 to 13', () => {
    expect(extractIsbnsFromText('ISBN 0-441-01359-7')).toContain(ISBN)
  })

  it('rejects a number that fails its check digit', () => {
    // Without check-digit validation the loose pattern would match any long
    // number on a copyright page.
    expect(extractIsbnsFromText('ISBN 978-0-441-01359-4')).toHaveLength(0)
  })

  it('ignores unrelated long numbers', () => {
    expect(extractIsbnsFromText('Printed in 2024. Order line 1 800 555 0199.'))
      .toHaveLength(0)
  })
})
