/**
 * Storing crops beside photographs.
 *
 * The rule these exist to hold down is that an original is never written to.
 * There are photographs of a real collection behind this and re-taking one
 * means physically finding the book again, so "the crop went in the wrong
 * place" has to be a recoverable mistake and not a lost photograph.
 */

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { openDatabase } from './db'
import { Store, type DraftBook } from './store'
import { cropCatalogue, cropName, cropPhotos, type CropIo } from './crop'
import { frontCover, photographedBook } from './fixtures'

function store(): Store {
  return new Store(openDatabase(':memory:'))
}

function draft(overrides: Partial<DraftBook> = {}): DraftBook {
  return {
    isbn13: '',
    isbn10: '',
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    isFiction: true,
    ...overrides,
  } as DraftBook
}

/** A directory that only exists in memory, so no test writes a photograph. */
function memory(files: Record<string, Buffer>): CropIo & { files: Record<string, Buffer> } {
  return {
    files,
    read: (name) => {
      const found = files[name]
      if (!found) throw new Error(`no such file: ${name}`)
      return found
    },
    write: (name, data) => { files[name] = data },
  }
}

async function photograph(seed = 1): Promise<Buffer> {
  const scene = await photographedBook(
    await frontCover('The Dispossessed', 'Ursula K. Le Guin'),
    { seed, width: 800, height: 1100, fill: 0.5, background: 'carpet' },
  )
  return scene.image
}

async function blank(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 500, channels: 3, background: '#6b6b6b' } })
    .jpeg()
    .toBuffer()
}

describe('cropName', () => {
  it('sits next to the photograph it came from', () => {
    expect(cropName('1770000000000_9780441013593_front.jpg'))
      .toBe('1770000000000_9780441013593_front_crop.jpg')
  })

  it('cannot collide with a photograph or a catalogue cover', () => {
    // saveImage ends every name with a slot and downloadCover with _cover, so
    // nothing either of them writes can end _crop.jpg.
    expect(cropName('1770000000000_noisbn_edge.jpg')).toMatch(/_crop\.jpg$/)
    expect(cropName('1770000000000_x_ab12cd34_cover.jpg')).toMatch(/_crop\.jpg$/)
  })

  it('copes with a name that has no extension at all', () => {
    expect(cropName('somefile')).toBe('somefile_crop.jpg')
  })
})

describe('cropPhotos', () => {
  it('writes a new file and never touches the photograph', async () => {
    const s = store()
    const original = await photograph()
    const io = memory({ 'a_front.jpg': original })

    const { id } = s.addBook(draft({ frontImage: 'a_front.jpg' } as Partial<DraftBook>))
    const outcomes = await cropPhotos(s, s.getBook(id)!, io, { apply: true })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.crop).toBe('a_front_crop.jpg')

    // The photograph is byte for byte what it was.
    expect(io.files['a_front.jpg']!.equals(original)).toBe(true)
    // And the crop is a different, smaller picture beside it.
    expect(io.files['a_front_crop.jpg']).toBeDefined()
    expect(io.files['a_front_crop.jpg']!.equals(original)).toBe(false)

    const book = s.getBook(id)!
    expect(book.front_image).toBe('a_front.jpg')
    expect(book.front_crop).toBe('a_front_crop.jpg')
    expect(book.cropped).toBe('front')
  }, 20_000)

  it('records that a photo was looked at even when no book was found', async () => {
    const s = store()
    const io = memory({ 'b_front.jpg': await blank() })

    const { id } = s.addBook(draft({ frontImage: 'b_front.jpg' } as Partial<DraftBook>))
    const outcomes = await cropPhotos(s, s.getBook(id)!, io, { apply: true })

    expect(outcomes[0]!.crop).toBe('')
    expect(outcomes[0]!.refusal).toBeTruthy()
    expect(io.files['b_front_crop.jpg']).toBeUndefined()

    const book = s.getBook(id)!
    // Looked at, found nothing. Different from never looked at, and it is the
    // difference that lets the detail view say "shown whole" about this photo
    // without saying it about every photo taken before any of this existed.
    expect(book.front_crop).toBe('')
    expect(book.cropped).toBe('front')
  })

  it('writes nothing at all without apply', async () => {
    const s = store()
    const io = memory({ 'c_front.jpg': await photograph(2) })

    const { id } = s.addBook(draft({ frontImage: 'c_front.jpg' } as Partial<DraftBook>))
    const outcomes = await cropPhotos(s, s.getBook(id)!, io)

    expect(outcomes[0]!.crop).toBe('c_front_crop.jpg')
    expect(Object.keys(io.files)).toEqual(['c_front.jpg'])
    expect(s.getBook(id)!.cropped).toBe('')
  }, 20_000)

  it('does the same photo twice only if told to', async () => {
    const s = store()
    const io = memory({ 'd_front.jpg': await photograph(3) })
    const { id } = s.addBook(draft({ frontImage: 'd_front.jpg' } as Partial<DraftBook>))

    await cropPhotos(s, s.getBook(id)!, io, { apply: true })
    const again = await cropPhotos(s, s.getBook(id)!, io, { apply: true })
    expect(again).toHaveLength(0)

    const forced = await cropPhotos(s, s.getBook(id)!, io, { apply: true, force: true })
    expect(forced).toHaveLength(1)
  }, 30_000)

  it('skips a photo it cannot read, without claiming it looked at it', async () => {
    const s = store()
    const io = memory({})
    const { id } = s.addBook(draft({ frontImage: 'gone.jpg' } as Partial<DraftBook>))

    const outcomes = await cropPhotos(s, s.getBook(id)!, io, { apply: true })
    expect(outcomes[0]!.refusal).toBe('unreadable')
    // Not marked examined: a missing file is a problem to fix, and recording
    // it as "no book found" would hide it behind a caption.
    expect(s.getBook(id)!.cropped).toBe('')
  })

  it('does each of the three slots that has a photo', async () => {
    const s = store()
    const io = memory({
      'e_front.jpg': await photograph(4),
      'e_edge.jpg': await photograph(5),
    })

    const { id } = s.addBook(draft({
      frontImage: 'e_front.jpg', edgeImage: 'e_edge.jpg',
    } as Partial<DraftBook>))

    const outcomes = await cropPhotos(s, s.getBook(id)!, io, { apply: true })
    expect(outcomes.map((o) => o.slot)).toEqual(['front', 'edge'])
    expect(s.getBook(id)!.cropped).toBe('front,edge')
    expect(s.getBook(id)!.back_crop).toBe('')
  }, 30_000)
})

describe('cropCatalogue', () => {
  it('counts what it did and leaves every photograph alone', async () => {
    const s = store()
    const good = await photograph(6)
    const io = memory({ 'f_front.jpg': good, 'g_front.jpg': await blank() })

    s.addBook(draft({ title: 'One', frontImage: 'f_front.jpg' } as Partial<DraftBook>))
    s.addBook(draft({ title: 'Two', frontImage: 'g_front.jpg' } as Partial<DraftBook>))

    const report = await cropCatalogue(s, { ...io, apply: true })

    expect(report.rows).toBe(2)
    expect(report.images).toBe(2)
    expect(report.cropped).toBe(1)
    expect(report.declined).toBe(1)
    expect(report.failed).toBe(0)
    expect(io.files['f_front.jpg']!.equals(good)).toBe(true)
  }, 30_000)

  it('is resumable: a second run finds nothing left to do', async () => {
    const s = store()
    const io = memory({ 'h_front.jpg': await photograph(7) })
    s.addBook(draft({ frontImage: 'h_front.jpg' } as Partial<DraftBook>))

    await cropCatalogue(s, { ...io, apply: true })
    const second = await cropCatalogue(s, { ...io, apply: true })

    expect(second.images).toBe(0)
    expect(second.skipped).toBe(1)
  }, 30_000)

  it('stops at the limit, so a cautious operator can look before committing', async () => {
    const s = store()
    const io = memory({ 'i_front.jpg': await blank(), 'j_front.jpg': await blank() })
    s.addBook(draft({ title: 'One', frontImage: 'i_front.jpg' } as Partial<DraftBook>))
    s.addBook(draft({ title: 'Two', frontImage: 'j_front.jpg' } as Partial<DraftBook>))

    const report = await cropCatalogue(s, { ...io, apply: true, limit: 1 })
    expect(report.images).toBe(1)
  })

  it('names a photograph it could not read instead of skipping it silently', async () => {
    const s = store()
    const io = memory({})
    s.addBook(draft({ title: 'Lost', frontImage: 'nowhere.jpg' } as Partial<DraftBook>))

    const report = await cropCatalogue(s, { ...io, apply: true })
    expect(report.failed).toBe(1)
    expect(report.failures[0]!.image).toBe('nowhere.jpg')
    expect(report.failures[0]!.title).toBe('Lost')
  })
})

describe('a crop is a file the catalogue owns', () => {
  it('counts as in use, so tidying up orphans cannot delete it', async () => {
    const s = store()
    const io = memory({ 'k_front.jpg': await photograph(8) })
    const { id } = s.addBook(draft({ frontImage: 'k_front.jpg' } as Partial<DraftBook>))
    await cropPhotos(s, s.getBook(id)!, io, { apply: true })

    expect(s.imageInUse('k_front_crop.jpg')).toBe(true)
    expect(s.imageInUse('k_front.jpg')).toBe(true)
    expect(s.imageInUse('nothing.jpg')).toBe(false)
  }, 20_000)
})
