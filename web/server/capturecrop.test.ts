/**
 * Crops and a front hash for a capture that is still in the queue.
 *
 * The two rules under test are the ones a mistake here would cost somebody: a
 * photograph is never written to, and a hash is never stored unless it was
 * computed from a frame with a book in it. A crop can be redone, and a capture
 * with none is a capture shown whole; a hash of a blank wall is the same width
 * and the same format as a hash of a book, so it goes on to be compared and
 * offered to somebody as the book in their hands.
 *
 * The detector and the hash are real here. They are the whole subject, and
 * `fixtures.ts` renders scenes whose true rectangle is known, so this pays a
 * few seconds rather than mocking the thing being tested.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { CaptureQueue } from './queue'
import { backfillCaptures, deriveCapture } from './capturecrop'
import type { CropIo } from './crop'
import { coverHash, distance } from './imagehash'
import { identify } from './identify'
import { lookupIsbn } from './lookup'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { frontCover, photographedBook } from './fixtures'

// The worker path drains a capture, and neither the reader nor the catalogue
// is what these tests are about. queue.test.ts and identify.test.ts already
// pay for both.
vi.mock('./identify', () => ({ identify: vi.fn() }))
vi.mock('./lookup', () => ({ lookupIsbn: vi.fn(), searchTitle: vi.fn() }))

let db: Db

beforeEach(async () => {
  db = await openTestDatabase()
  vi.mocked(identify).mockReset()
  vi.mocked(lookupIsbn).mockReset()
})

afterAll(closeTestDatabase)

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

/** A photograph the reader made nothing of, which is every front cover here. */
function readNothing() {
  return {
    isbn13: '', isbn10: '', source: '' as const, barcodes: [], titleGuess: '',
    coverLines: [], isbnCandidates: [], text: '', notes: [],
  }
}

/** A frame with nothing in it: no book to crop and no detail to hash. */
async function blank(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 500, channels: 3, background: '#6b6b6b' } })
    .jpeg()
    .toBuffer()
}

describe('deriving a capture', () => {
  it('crops the front and never touches the photograph', async () => {
    const queue = new CaptureQueue(db, () => null)
    const original = await photograph()
    const io = memory({ 'a_front.jpg': original })

    const capture = await queue.add({ front: 'a_front.jpg' })
    const outcome = await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })

    expect(outcome.crops.map((slot) => slot.crop)).toEqual(['a_front_crop.jpg'])

    // The photograph is byte for byte what it was, and the crop is a second
    // picture beside it.
    expect(io.files['a_front.jpg']!.equals(original)).toBe(true)
    expect(io.files['a_front_crop.jpg']).toBeDefined()
    expect(io.files['a_front_crop.jpg']!.equals(original)).toBe(false)

    const row = (await queue.get(capture.id))!
    expect(row.front_image).toBe('a_front.jpg')
    expect(row.front_crop).toBe('a_front_crop.jpg')
    expect(row.cropped).toBe('front')
  }, 30_000)

  it('hashes the front in the format the books path compares against', async () => {
    const queue = new CaptureQueue(db, () => null)
    const front = await photograph(2)
    const io = memory({ 'b_front.jpg': front })

    const capture = await queue.add({ front: 'b_front.jpg' })
    const outcome = await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })

    expect(outcome.hash).toBe('written')
    const stored = (await queue.get(capture.id))!.front_hash

    // Not merely non-empty: the same string a book's photograph would get, so
    // a scan compared against the queue is comparing like with like. `distance`
    // answers 64 for anything written by another scheme, so a zero here is the
    // format tag and the algorithm both agreeing.
    expect(stored).toBe(await coverHash(front))
    expect(stored.startsWith('p1')).toBe(true)
    expect(distance(stored, await coverHash(front))).toBe(0)
  }, 30_000)

  it('records that a photo was looked at even when no book was found', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({ 'c_front.jpg': await blank() })

    const capture = await queue.add({ front: 'c_front.jpg' })
    const outcome = await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })

    expect(outcome.crops[0]!.crop).toBe('')
    expect(outcome.crops[0]!.refusal).toBeTruthy()
    expect(io.files['c_front_crop.jpg']).toBeUndefined()

    const row = (await queue.get(capture.id))!
    // Looked at, found nothing. A different state from never looked at, and it
    // is the difference that lets the queue say "shown whole" about this photo
    // without saying it about every photo taken before any of this existed.
    expect(row.front_crop).toBe('')
    expect(row.cropped).toBe('front')
  }, 20_000)

  it('refuses to hash a frame with no detail rather than storing a number', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({ 'd_front.jpg': await blank() })

    const capture = await queue.add({ front: 'd_front.jpg' })
    const outcome = await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })

    expect(outcome.hash).toBe('refused')
    // Empty, not a hash of a flat surface. A wrong match is worse than none.
    expect((await queue.get(capture.id))!.front_hash).toBe('')
  }, 20_000)

  it('writes nothing at all without apply', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({ 'e_front.jpg': await photograph(3) })

    const capture = await queue.add({ front: 'e_front.jpg' })
    const outcome = await deriveCapture(queue, (await queue.get(capture.id))!, io)

    expect(outcome.crops[0]!.crop).toBe('e_front_crop.jpg')
    expect(outcome.hash).toBe('written')
    expect(Object.keys(io.files)).toEqual(['e_front.jpg'])

    const row = (await queue.get(capture.id))!
    expect(row.cropped).toBe('')
    expect(row.front_hash).toBe('')
  }, 30_000)

  it('does the same capture twice only if told to', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({ 'f_front.jpg': await photograph(4) })
    const capture = await queue.add({ front: 'f_front.jpg' })

    await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })
    const again = await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })
    expect(again.crops).toHaveLength(0)
    expect(again.hash).toBe('kept')

    const forced = await deriveCapture(
      queue, (await queue.get(capture.id))!, io, { apply: true, force: true },
    )
    expect(forced.crops).toHaveLength(1)
    // Recomputed from the same photograph, so the same string: 'kept' here is
    // "it was read again and had not changed", not "it was skipped".
    expect(forced.hash).toBe('kept')
  }, 60_000)

  it('leaves a capture whose photograph has gone missing exactly as it was', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({})
    const capture = await queue.add({ front: 'gone.jpg' })

    const outcome = await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })

    expect(outcome.crops[0]!.refusal).toBe('unreadable')
    expect(outcome.hash).toBe('unreadable')
    // Not marked examined and not hashed: a missing file is a problem to fix,
    // and recording it as "no book found" would hide it behind a caption.
    const row = (await queue.get(capture.id))!
    expect(row.cropped).toBe('')
    expect(row.front_hash).toBe('')
  })

  it('crops each of the three slots that has a photo, and hashes only the front', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({
      'g_front.jpg': await photograph(5),
      'g_edge.jpg': await photograph(6),
    })

    const capture = await queue.add({ front: 'g_front.jpg', edge: 'g_edge.jpg' })
    const outcome = await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })

    expect(outcome.crops.map((slot) => slot.slot)).toEqual(['front', 'edge'])

    const row = (await queue.get(capture.id))!
    expect(row.cropped).toBe('front,edge')
    expect(row.back_crop).toBe('')
    expect(row.front_hash).not.toBe('')
  }, 60_000)
})

describe('the worker does it, so nobody waits', () => {
  it('crops and hashes on the same background pass that reads the photographs', async () => {
    vi.mocked(identify).mockResolvedValue({
      isbn13: '', isbn10: '', source: '' as const, barcodes: [], titleGuess: '',
      coverLines: [], isbnCandidates: [], text: '', notes: [],
    })
    const io = memory({ 'h_front.jpg': await photograph(7) })

    // The shape index.ts builds: a photograph reader, and somewhere to read
    // and write derived pictures.
    const queue = new CaptureQueue(
      db, (name) => io.files[name] ?? null, {}, io,
    )

    const capture = await queue.attach(null, 'front', 'h_front.jpg')
    // Exactly what POST /api/captures fires and does not await.
    await queue.drain()

    const row = (await queue.get(capture.id))!
    expect(row.front_crop).toBe('h_front_crop.jpg')
    expect(row.cropped).toBe('front')
    expect(row.front_hash).not.toBe('')
    expect(io.files['h_front_crop.jpg']).toBeDefined()
  }, 30_000)

  it('hands back a crop whose capture was discarded while it was being written', async () => {
    // The window the deferred discard opens (src/lib/discardWindow.ts): the
    // delete arrives ten seconds after the swipe, so it can land in the second
    // this pass spends cropping. It sweeps the crops the row named at the
    // time, which is none, and the file lands afterwards pointing at nothing.
    vi.mocked(identify).mockResolvedValue({
      isbn13: '', isbn10: '', source: '' as const, barcodes: [], titleGuess: '',
      coverLines: [], isbnCandidates: [], text: '', notes: [],
    })
    const io = memory({ 'p_front.jpg': await photograph(11) })
    const orphaned: string[][] = []
    /** The discard, fired at the worst possible moment: mid-write. */
    let discard: (() => void) | null = null

    const queue = new CaptureQueue(db, (name) => io.files[name] ?? null, {}, {
      read: io.read,
      write: (name, data) => { io.write(name, data); discard?.() },
      orphaned: (names) => { orphaned.push(names) },
    })

    const capture = await queue.attach(null, 'front', 'p_front.jpg')
    discard = () => { void queue.discard(capture.id) }
    await queue.drain()

    // The row is still there. A discard is a state now, not a delete (#183),
    // so what says the scan went is the state rather than the absence of a row.
    expect((await queue.get(capture.id))?.status).toBe('done')
    // Named to the caller's own sweep rather than deleted here, so the check
    // that a shelved book does not still want the file is the same one.
    expect(orphaned).toEqual([['p_front_crop.jpg']])
  }, 30_000)

  it('leaves the photographs alone when nowhere was given to write derivatives', async () => {
    vi.mocked(identify).mockResolvedValue({
      isbn13: '', isbn10: '', source: '' as const, barcodes: [], titleGuess: '',
      coverLines: [], isbnCandidates: [], text: '', notes: [],
    })
    const queue = new CaptureQueue(db, () => Buffer.from('a photograph'))

    const capture = await queue.attach(null, 'front', 'i_front.jpg')
    await queue.drain()

    const row = (await queue.get(capture.id))!
    expect(row.cropped).toBe('')
    expect(row.front_hash).toBe('')
  })
})

describe('backfilling the captures already queued', () => {
  it('counts what it did and leaves every photograph alone', async () => {
    const queue = new CaptureQueue(db, () => null)
    const good = await photograph(8)
    const io = memory({ 'j_front.jpg': good, 'k_front.jpg': await blank() })

    await queue.add({ front: 'j_front.jpg' })
    await queue.add({ front: 'k_front.jpg' })

    const report = await backfillCaptures(queue, { ...io, apply: true })

    expect(report.rows).toBe(2)
    expect(report.images).toBe(2)
    expect(report.cropped).toBe(1)
    expect(report.declined).toBe(1)
    expect(report.hashed).toBe(1)
    expect(report.hashRefused).toBe(1)
    expect(report.failed).toBe(0)
    expect(io.files['j_front.jpg']!.equals(good)).toBe(true)
  }, 60_000)

  it('is resumable: a second run finds nothing left to do', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({ 'l_front.jpg': await photograph(9) })
    await queue.add({ front: 'l_front.jpg' })

    await backfillCaptures(queue, { ...io, apply: true })
    const second = await backfillCaptures(queue, { ...io, apply: true })

    expect(second.images).toBe(0)
    expect(second.skipped).toBe(1)
    expect(second.hashed).toBe(0)
    expect(second.hashKept).toBe(1)
  }, 60_000)

  it('stops at the limit, so a cautious operator can look before committing', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({ 'm_front.jpg': await blank(), 'n_front.jpg': await blank() })
    await queue.add({ front: 'm_front.jpg' })
    await queue.add({ front: 'n_front.jpg' })

    const report = await backfillCaptures(queue, { ...io, apply: true, limit: 1 })
    expect(report.rows).toBe(1)
    expect(report.images).toBe(1)
  }, 20_000)

  it('names a photograph it could not read instead of skipping it silently', async () => {
    const queue = new CaptureQueue(db, () => null)
    const io = memory({})
    await queue.add({ front: 'nowhere.jpg' })

    const report = await backfillCaptures(queue, { ...io, apply: true })
    expect(report.failed).toBe(2) // once for the crop, once for the hash
    expect(report.failures.map((failure) => failure.image)).toEqual(['nowhere.jpg', 'nowhere.jpg'])
  })
})

/**
 * The hash is what stops the catalogue growing a second copy of a book (#237),
 * so the ways it can fail to be written are the subject here rather than a
 * detail of the pass that writes it.
 *
 * Every test below makes the hash fail on purpose, in a way that had left the
 * capture with an empty hash forever: nothing retried it, nothing said so, and
 * `waiting()` leaves an unhashed capture out, so holding the book up again
 * found nothing at all.
 */
describe('a capture is hashed whatever else goes wrong', () => {
  /** A shape the queue is happy to write crops to, and this one refuses. */
  function cropsFailing(files: Record<string, Buffer>) {
    return {
      read: (name: string) => {
        const found = files[name]
        if (!found) throw new Error(`no such file: ${name}`)
        return found
      },
      write: () => { throw new Error('the disk is full') },
    }
  }

  it('is hashed even when writing the crop throws', async () => {
    vi.mocked(identify).mockResolvedValue(readNothing())
    const files = { 'q_front.jpg': await photograph(12) }
    const queue = new CaptureQueue(
      db, (name) => files[name as keyof typeof files] ?? null, {}, cropsFailing(files),
    )

    const capture = await queue.attach(null, 'front', 'q_front.jpg')
    await queue.drain()

    // The crop is gone, which is what a failing detector costs and all it
    // should cost: the crop is decoration, the hash is the duplicate check.
    const row = (await queue.get(capture.id))!
    expect(row.front_crop).toBe('')
    expect(row.front_hash).not.toBe('')

    // And the capture is offered to the next person holding the same book up.
    expect((await queue.waiting()).map((one) => one.id)).toEqual([capture.id])
  }, 30_000)

  it('is hashed without waiting for a reading that never comes back', async () => {
    // A reading that hangs is not hypothetical: `identify` serialises every
    // caller onto one promise chain and downloads its language data on first
    // use, so one stall holds up every capture behind it for the life of the
    // process. The hash must not be behind it.
    vi.mocked(identify).mockReturnValue(new Promise(() => {}))
    const io = memory({ 'r_front.jpg': await photograph(13) })
    const queue = new CaptureQueue(db, (name) => io.files[name] ?? null, {}, io)

    const capture = await queue.attach(null, 'front', 'r_front.jpg')
    // The two things POST /api/captures fires and does not await. The reading
    // never finishes; the hash does not care.
    void queue.drain()
    expect(await queue.hashFrontOf(capture.id)).toBe('written')

    const row = (await queue.get(capture.id))!
    expect(row.status).toBe('pending')
    expect(row.front_hash).not.toBe('')
    expect((await queue.waiting()).map((one) => one.id)).toEqual([capture.id])
  }, 30_000)

  it('sweeps up the captures a stopped server never got to', async () => {
    vi.mocked(identify).mockResolvedValue(readNothing())
    const io = memory({ 's_front.jpg': await photograph(14), 't_front.jpg': await blank() })

    // Photographed by a server that died before it hashed anything, which is
    // what `add` leaves behind: rows with photographs and no hash.
    const cold = new CaptureQueue(db, () => null)
    const good = await cold.add({ front: 's_front.jpg' })
    const flat = await cold.add({ front: 't_front.jpg' })
    expect((await cold.unhashed()).map((one) => one.id)).toEqual([good.id, flat.id])

    const queue = new CaptureQueue(db, (name) => io.files[name] ?? null, {}, io)
    const sweep = await queue.hashQueued()

    // One hashed, one refused because there is no detail in it to hash. A
    // refusal is counted and named rather than stored as a number that would
    // go on to be compared against somebody's book.
    expect(sweep).toEqual({ looked: 2, written: 1, refused: 1, unreadable: 0 })
    expect((await queue.get(good.id))!.front_hash).not.toBe('')
    expect((await queue.get(flat.id))!.front_hash).toBe('')

    // Resumable: the second sweep has only the one it can never hash left.
    expect(await queue.hashQueued()).toEqual({
      looked: 1, written: 0, refused: 1, unreadable: 0,
    })
  }, 60_000)
})

describe("a capture's crop is a file the catalogue owns", () => {
  it('counts as in use, so tidying up orphans cannot delete it', async () => {
    const queue = new CaptureQueue(db, () => null)
    const store = new Store(db, new DrizzleAuthorRepository(db))
    const io = memory({ 'o_front.jpg': await photograph(10) })

    const capture = await queue.add({ front: 'o_front.jpg' })
    await deriveCapture(queue, (await queue.get(capture.id))!, io, { apply: true })

    expect(await store.imageInUse('o_front_crop.jpg')).toBe(true)
    expect(await store.imageInUse('o_front.jpg')).toBe(true)
    expect(await store.imageInUse('nothing.jpg')).toBe(false)
  }, 30_000)
})
