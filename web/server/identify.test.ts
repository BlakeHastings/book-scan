/**
 * These exercise the real zbar and tesseract pipelines against generated
 * covers. They are slower than the rest of the suite and that is the point:
 * the live browser scanner passed its unit tests and still could not read a
 * book, because nothing tested it against an actual image.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { backCover, barcodePng, frontCover, glossy } from './fixtures'
import sharp from 'sharp'
import {
  decodeBarcodes, identify, pickCoverLines, pickTitle, regionAroundBarcode,
  shutdownOcr,
} from './identify'
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
    expect(result.notes.join(' ')).toContain('not an ISBN')
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

describe('concurrent identification', () => {
  it('serialises overlapping calls and keeps results correct', async () => {
    // Two people scanning at once used to mean two simultaneous calls into a
    // tesseract worker that handles one job at a time. Each result must still
    // match its own input.
    const [dune, none] = await Promise.all([
      identify(await backCover(ISBN), { ocrEnabled: false }),
      identify(await backCover(ISBN, { barcode: false, printedIsbn: false }), {
        ocrEnabled: false,
      }),
    ])

    expect(dune.isbn13).toBe(ISBN)
    expect(none.isbn13).toBe('')
  }, 60_000)
})

describe('pre-ISBN-13 paperback: UPC barcode, ISBN only in print', () => {
  // Modelled on a real failure: V.C. Andrews, Dark Angel (1986). The back
  // cover carries a retail UPC-A, not a Bookland EAN, and the only ISBN on
  // the book is the printed line. Barcode-only identification cannot work.
  const ISBN10 = '0671525433'
  const ISBN13 = '9780671525439'
  const UPC = '076714004504'

  it('does not mistake the retail UPC for the book', async () => {
    const cover = await backCover(ISBN13, { upc: UPC, printedIsbn: false })
    const result = await identify(cover, { ocrEnabled: false })
    // zbar promotes UPC-A to EAN-13 by prefixing a zero, so the decoded value
    // is 0076714004504. It has a valid checksum and is still not a book.
    expect(result.barcodes.some((b) => b.endsWith(UPC))).toBe(true)
    expect(result.isbn13).toBe('')
    expect(result.notes.join(' ')).toContain('not an ISBN')
  }, 60_000)

  it('reads the printed ISBN-10 instead, and reports both forms', async () => {
    const cover = await backCover(ISBN13, {
      upc: UPC, printedIsbn: true, printIsbn10: ISBN10,
    })
    const result = await identify(cover)
    expect(result.isbn13).toBe(ISBN13)
    expect(result.isbn10).toBe(ISBN10)
    expect(result.source).toBe('ocr')
  }, 120_000)
})

describe('reading a front cover', () => {
  it('discards artwork debris that is not words', () => {
    // Verbatim lines from OCR over an illustrated cover. The largest of them
    // used to become the book's title.
    expect(pickCoverLines([
      { text: '4] F', height: 400, words: 2 },
      { text: ': R 0', height: 380, words: 3 },
      { text: 'dy', height: 300, words: 1 },
      { text: 'DUNE', height: 200, words: 1 },
    ])).toEqual(['DUNE'])
  })

  it('discards series taglines', () => {
    // A real one that became a title: the largest non-noise line on the cover.
    expect(pickCoverLines([
      { text: 'THE STORY OF THE CASTEEL FAMILY CONTINUES', height: 400, words: 7 },
      { text: 'THE EXTRAORDINARY NEW BESTSELLER!', height: 390, words: 4 },
      { text: 'VCANDREWS', height: 300, words: 1 },
    ])).toEqual(['VCANDREWS'])
  })

  it('returns several lines, largest first, since either may be the title', () => {
    expect(pickCoverLines([
      { text: 'Frank Herbert', height: 100, words: 2 },
      { text: 'DUNE', height: 300, words: 1 },
    ])).toEqual(['DUNE', 'Frank Herbert'])
  })

  it('trims the stray marks OCR tacks onto big cover type', () => {
    expect(pickCoverLines([{ text: 'VCANDREWS |', height: 300, words: 2 }]))
      .toEqual(['VCANDREWS'])
  })

  it('returns nothing rather than debris when a cover is unreadable', () => {
    expect(pickCoverLines([
      { text: '~~', height: 200, words: 1 },
      { text: 'X', height: 190, words: 1 },
    ])).toEqual([])
  })

  it('still finds a plain title on a plain cover', async () => {
    const result = await identify(await frontCover('DUNE', 'Frank Herbert'), {
      wantTitle: true,
    })
    expect(result.coverLines.join(' ').toUpperCase()).toContain('DUNE')
  }, 120_000)
})

describe('barcode region, the crop handed to OCR', () => {
  const meta = { width: 2160, height: 3840 }
  const image = () => sharp({
    create: { width: meta.width, height: meta.height, channels: 3, background: '#fff' },
  }).jpeg().toBuffer()

  it('crops around a real barcode', async () => {
    const region = regionAroundBarcode(
      await image(),
      { left: 1192, top: 2327, width: 257, height: 125 },
      meta,
    )
    expect(region).not.toBeNull()
    const out = await sharp(await region!).metadata()
    // Both sides bounded, whatever the aspect ratio going in.
    expect(out.width!).toBeLessThanOrEqual(5000)
    expect(out.height!).toBeLessThanOrEqual(5000)
  })

  it('refuses a symbol with no width', async () => {
    // Taken from the capture that killed the server: zbar reported collinear
    // points, so the box had zero width. Padding made it a 1x21 crop, and the
    // upscale turned that into 2000x42000, which leptonica refuses and which
    // took the OCR worker, and then the whole process, down with it.
    const region = regionAroundBarcode(
      await image(),
      { left: 1442.2153846153847, top: 2414.2153846153847, width: 0, height: 4.984615384615385 },
      meta,
    )
    expect(region).toBeNull()
  })

  it('refuses a box that clips away to nothing at the edge', async () => {
    const region = regionAroundBarcode(
      await image(),
      { left: meta.width - 2, top: 10, width: 1, height: 40 },
      meta,
    )
    expect(region).toBeNull()
  })
})
