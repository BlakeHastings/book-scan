/**
 * The rehash path, against a real database and real generated cover images. No
 * file is opened: the tool takes its image reader from the caller, so a test
 * hands it a map and never names a directory.
 *
 * Since stage F this runs against both databases, and nothing below knows
 * which. See server/testdb.ts.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { frontCover } from './fixtures'
import { coverHash, distance } from './imagehash'
import { isCurrentFormat, rehashCovers, type ReadImage } from './rehash'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

/** What the difference hash used to write: sixteen hex characters, no tag. */
const OLD_FRONT = '0f1e2d3c4b5a6978'
const OLD_COVER = 'ffee00112233ccdd'

let db: Db
let store: Store
let images: Map<string, Buffer>
let read: ReadImage

/** Reads from the map, and throws the way a missing file does. */
function reader(map: Map<string, Buffer>): ReadImage {
  return (name) => {
    const found = map.get(name)
    if (!found) throw new Error(`ENOENT: no such file or directory, open '${name}'`)
    return found
  }
}

async function addBook(
  title: string,
  author: string,
  names: { front?: string; cover?: string },
  hashes: { front?: string; cover?: string } = {},
): Promise<number> {
  const { id } = await store.addBook({
    title,
    authors: [author],
    genre: FICTION_SLUG,
    frontImage: names.front ?? '',
  })
  if (names.cover) await store.setCoverImage(id, names.cover)
  if (hashes.front || hashes.cover) {
    await store.setHashes(id, hashes.front ?? '', hashes.cover ?? '')
  }
  if (names.front) images.set(names.front, await frontCover(title, author))
  if (names.cover) images.set(names.cover, await frontCover(title, author))
  return id
}

async function hashesOf(id: number): Promise<{ front: string; cover: string }> {
  const row = (await store.getBook(id))!
  return { front: row.front_hash, cover: row.cover_hash }
}

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  images = new Map()
  read = reader(images)
})

/** The hashes on the photographs themselves, rather than on the book row. */
async function photographHashes(id: number): Promise<Record<string, string>> {
  const rows = await db.all<{ kind: string; hash: string }>(
    'SELECT kind, hash FROM capture WHERE book_id = ? ORDER BY kind', [id],
  )
  return Object.fromEntries(rows.map((row) => [row.kind, row.hash]))
}

afterAll(closeTestDatabase)

describe('telling a stale hash from a current one', () => {
  it('rejects everything the old algorithm wrote', async () => {
    expect(isCurrentFormat(OLD_FRONT)).toBe(false)
    // Which is the same answer the matcher gives, and the reason for the tool.
    expect(distance(OLD_FRONT, OLD_FRONT)).toBe(64)
  })

  it('accepts what the current one writes, and nothing empty or truncated', async () => {
    const hash = await coverHash(await frontCover('Dune', 'Frank Herbert'))
    expect(isCurrentFormat(hash)).toBe(true)
    expect(isCurrentFormat('')).toBe(false)
    expect(isCurrentFormat('p1')).toBe(false)
  })
})

describe('a dry run', () => {
  it('reports the work without touching a single row', async () => {
    const id = await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg', cover: 'dune_cover.jpg' },
      { front: OLD_FRONT, cover: OLD_COVER },
    )

    const report = await rehashCovers(store, { read })

    expect(report.rows).toBe(1)
    expect(report.images).toBe(2)
    expect(report.rehashed).toBe(2)
    expect(report.skipped).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.changed).toBe(1)

    // The point of the flag: the catalogue is exactly as it was.
    expect(await hashesOf(id)).toEqual({ front: OLD_FRONT, cover: OLD_COVER })
  })
})

describe('applying', () => {
  it('replaces a stale hash with one the matcher accepts', async () => {
    const id = await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg' },
      { front: OLD_FRONT },
    )

    const report = await rehashCovers(store, { read, apply: true })
    expect(report.rehashed).toBe(1)
    expect(report.changed).toBe(1)

    const { front } = await hashesOf(id)
    expect(front).not.toBe(OLD_FRONT)
    expect(isCurrentFormat(front)).toBe(true)

    // The whole purpose: the same book photographed again now matches, where
    // before the stale hash answered 64 to everything.
    const again = await coverHash(images.get('dune_front.jpg')!)
    expect(distance(front, again)).toBe(0)
  })

  it('leaves the books it has already done alone on a second run', async () => {
    await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg', cover: 'dune_cover.jpg' },
      { front: OLD_FRONT, cover: OLD_COVER },
    )
    await addBook(
      'Neuromancer', 'William Gibson',
      { front: 'neuro_front.jpg' },
      { front: OLD_FRONT },
    )

    const first = await rehashCovers(store, { read, apply: true })
    expect(first.rehashed).toBe(3)
    expect(first.changed).toBe(2)

    const second = await rehashCovers(store, { read, apply: true })
    expect(second.rows).toBe(2)
    expect(second.images).toBe(3)
    expect(second.rehashed).toBe(0)
    expect(second.skipped).toBe(3)
    expect(second.changed).toBe(0)
  })

  it('picks up where an interrupted run left off', async () => {
    const done = await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg' },
      { front: await coverHash(await frontCover('Dune', 'Frank Herbert')) },
    )
    const todo = await addBook(
      'Neuromancer', 'William Gibson',
      { front: 'neuro_front.jpg' },
      { front: OLD_FRONT },
    )

    const report = await rehashCovers(store, { read, apply: true })
    expect(report.skipped).toBe(1)
    expect(report.rehashed).toBe(1)
    expect(isCurrentFormat((await hashesOf(done)).front)).toBe(true)
    expect(isCurrentFormat((await hashesOf(todo)).front)).toBe(true)
  })

  it('redoes current hashes when forced', async () => {
    await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg' },
      { front: await coverHash(await frontCover('Dune', 'Frank Herbert')) },
    )

    const report = await rehashCovers(store, { read, apply: true, force: true })
    expect(report.skipped).toBe(0)
    expect(report.rehashed).toBe(1)
    // Recomputed to the same value, so there is nothing to write.
    expect(report.changed).toBe(0)
  })

  it('hashes an image that was never hashed at all', async () => {
    const id = await addBook('Dune', 'Frank Herbert', { front: 'dune_front.jpg' })

    const report = await rehashCovers(store, { read, apply: true })
    expect(report.rehashed).toBe(1)
    expect(isCurrentFormat((await hashesOf(id)).front)).toBe(true)
  })

  /*
   * The CLI half of #200. `rehash-covers.ts` is argument parsing and a file
   * reader around exactly the call below, so a hash that reached the column
   * and not the photograph is the drift that issue is about, arriving from a
   * tool the server never runs.
   */
  it('writes the new hash onto the photograph, not only onto the book row', async () => {
    const id = await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg', cover: 'dune_cover.jpg' },
      { front: OLD_FRONT, cover: OLD_COVER },
    )
    expect(await photographHashes(id)).toEqual({ catalogue: OLD_COVER, front: OLD_FRONT })

    await rehashCovers(store, { read, apply: true })

    const { front, cover } = await hashesOf(id)
    expect(await photographHashes(id)).toEqual({ catalogue: cover, front })
    expect(isCurrentFormat(front)).toBe(true)
    expect(isCurrentFormat(cover)).toBe(true)
  })
})

describe('images that cannot be read', () => {
  it('counts and names the missing file, and keeps going', async () => {
    const gone = await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg' },
      { front: OLD_FRONT },
    )
    images.delete('dune_front.jpg')

    const fine = await addBook(
      'Neuromancer', 'William Gibson',
      { front: 'neuro_front.jpg' },
      { front: OLD_FRONT },
    )

    const report = await rehashCovers(store, { read, apply: true })

    expect(report.failed).toBe(1)
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]!.id).toBe(gone)
    expect(report.failures[0]!.image).toBe('dune_front.jpg')
    expect(report.failures[0]!.reason).toContain('dune_front.jpg')

    // Progress is not lost to one bad row.
    expect(report.rehashed).toBe(1)
    expect(isCurrentFormat((await hashesOf(fine)).front)).toBe(true)
    // And the unreadable one keeps the hash it had rather than being blanked.
    expect((await hashesOf(gone)).front).toBe(OLD_FRONT)
  })

  it('does not blank the other image on the same book', async () => {
    const id = await addBook(
      'Dune', 'Frank Herbert',
      { front: 'dune_front.jpg', cover: 'dune_cover.jpg' },
      { front: OLD_FRONT, cover: OLD_COVER },
    )
    images.delete('dune_cover.jpg')

    const report = await rehashCovers(store, { read, apply: true })
    expect(report.failed).toBe(1)

    const { front, cover } = await hashesOf(id)
    expect(isCurrentFormat(front)).toBe(true)
    expect(cover).toBe(OLD_COVER)
  })

  it('cannot be left with a stale hash and no photograph to rehash it from', async () => {
    /*
     * This used to be a state, and it used to be reported: a hash was a column
     * on the book, so a book could carry one for a photograph it no longer
     * named, which no run of this tool could ever fix. Somebody had to be told.
     *
     * A hash is a fact about a photograph now and lives on that photograph's
     * row (#228), so there is nowhere for one to sit without an image behind
     * it. Offering one for a book with no artwork records nothing at all, which
     * is the honest answer rather than a refusal.
     */
    const id = await addBook('Dune', 'Frank Herbert', {}, { cover: OLD_COVER })
    expect(await photographHashes(id)).toEqual({})

    const report = await rehashCovers(store, { read, apply: true })
    expect(report.rows).toBe(0)
    expect(report.failed).toBe(0)
    expect((await hashesOf(id)).cover).toBe('')
  })
})
