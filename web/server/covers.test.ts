/**
 * Fetching and storing a publisher's cover.
 *
 * Real sharp and a real directory, but not a real network: the fetch is
 * handed in, so these serve generated images from memory and CI never
 * depends on Open Library being up. What is being tested is the filter, not
 * the endpoints: every one of these sources says "no cover" in a different
 * way, several of them with a 200, and anything that gets past this is
 * written to disk and shown to somebody as the book they are holding.
 *
 * The scratch directory lives under web/data, which .gitignore already
 * excludes and which is inside the checkout. Nothing here writes anywhere
 * else, and nothing here opens a database.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { downloadCover, openLibraryCover, upgradeGoogleCover } from './covers'

const ISBN = '9780441013593' // Dune

let dir: string

beforeAll(() => {
  const data = fileURLToPath(new URL('../data/', import.meta.url))
  mkdirSync(data, { recursive: true })
  dir = mkdtempSync(join(data, 'covers-test-'))
})

afterEach(() => {
  for (const name of readdirSync(dir)) rmSync(join(dir, name))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface Stub {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  calls: { url: string; init?: RequestInit }[]
}

/** A fetch that answers from memory and remembers what it was asked. */
function serve(reply: (url: string) => Response | Promise<Response>): Stub {
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    stub.calls.push({ url: String(input), init })
    return reply(String(input))
  }) as Stub
  stub.calls = []
  return stub
}

/**
 * A JPEG of the given size, detailed enough not to compress to nothing.
 *
 * Returned as an ArrayBuffer, which is what a Response body takes.
 */
async function image(width: number, height: number): Promise<ArrayBuffer> {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 7919) % 256
  const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer()
  return jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer
}

/** What downloadCover was given, as a typeof fetch. */
const asFetch = (stub: Stub) => stub as unknown as typeof fetch

const files = () => readdirSync(dir)

describe('the URL a cover is asked for', () => {
  it('asks Open Library by ISBN, and for a 404 rather than a placeholder', () => {
    const url = openLibraryCover(ISBN)

    expect(url).toBe(`https://covers.openlibrary.org/b/isbn/${ISBN}-L.jpg?default=false`)
    // Without default=false a book with no cover comes back as a stock
    // image with a 200, and it would be stored as though it were real.
    expect(url).toContain('default=false')
  })

  it('escapes an ISBN that is not what an ISBN should be', () => {
    // The value comes off a photograph by way of OCR, so it is not
    // guaranteed to be 13 digits by the time it reaches here.
    expect(openLibraryCover('978 0441/013593')).toContain('978%200441%2F013593')
  })

  it('asks Google for a bigger picture than it offers', () => {
    const thumbnail =
      'http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'

    const upgraded = upgradeGoogleCover(thumbnail)
    expect(upgraded).toContain('zoom=2')
    expect(upgraded).not.toContain('zoom=1')
    // The curled page corner is drawn over the artwork, which is the part
    // being compared with a photograph.
    expect(upgraded).not.toContain('edge=curl')
  })

  it('leaves a URL from anywhere else exactly as it found it', () => {
    const other = 'https://covers.openlibrary.org/b/isbn/9780441013593-L.jpg?default=false&zoom=1'
    expect(upgradeGoogleCover(other)).toBe(other)
  })
})

describe('storing a cover that is really there', () => {
  it('writes a JPEG named for the ISBN and returns the name', async () => {
    const fetchImpl = serve(async () => new Response(await image(600, 900)))

    const name = await downloadCover(openLibraryCover(ISBN), ISBN, dir, asFetch(fetchImpl))

    expect(name).toMatch(new RegExp(`^\\d+_${ISBN}_cover\\.jpg$`))
    expect(files()).toEqual([name])
    expect((await sharp(join(dir, name)).metadata()).format).toBe('jpeg')
  })

  it('follows redirects and gives up rather than hanging', async () => {
    // Open Library answers a cover request with a redirect, and a stalled
    // connection would otherwise hold a save open indefinitely.
    const fetchImpl = serve(async () => new Response(await image(600, 900)))
    await downloadCover('https://example.test/cover.jpg', ISBN, dir, asFetch(fetchImpl))

    expect(fetchImpl.calls[0]!.init?.redirect).toBe('follow')
    expect(fetchImpl.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('shrinks a large scan to something worth storing', async () => {
    const fetchImpl = serve(async () => new Response(await image(2400, 3600)))

    const name = await downloadCover('https://example.test/big.jpg', ISBN, dir, asFetch(fetchImpl))
    const meta = await sharp(join(dir, name)).metadata()

    expect(meta.width).toBe(1000)
    // Resized inside the box, so the shape of the book is not altered.
    expect(meta.height).toBe(1500)
  })

  it('does not blow a small cover up to fill the box', async () => {
    const fetchImpl = serve(async () => new Response(await image(300, 450)))

    const name = await downloadCover('https://example.test/small.jpg', ISBN, dir, asFetch(fetchImpl))

    expect((await sharp(join(dir, name)).metadata()).width).toBe(300)
  })

  it('still names the file when there is no ISBN to name it after', async () => {
    // A cover can be fetched from a title search, before any ISBN is known.
    const fetchImpl = serve(async () => new Response(await image(600, 900)))

    const name = await downloadCover('https://example.test/cover.jpg', '', dir, asFetch(fetchImpl))
    expect(name).toMatch(/^\d+_noisbn_cover\.jpg$/)
  })
})

describe('the several ways a source says no', () => {
  it('does not ask at all when there is no URL', async () => {
    const fetchImpl = serve(async () => new Response(await image(600, 900)))

    expect(await downloadCover('', ISBN, dir, asFetch(fetchImpl))).toBe('')
    expect(fetchImpl.calls).toHaveLength(0)
    expect(files()).toHaveLength(0)
  })

  it('stores nothing on a 404', async () => {
    const fetchImpl = serve(async () => new Response('Not found', { status: 404 }))

    expect(await downloadCover(openLibraryCover(ISBN), ISBN, dir, asFetch(fetchImpl))).toBe('')
    expect(files()).toHaveLength(0)
  })

  it('stores nothing when a 200 carries a few bytes of nothing', async () => {
    // The commonest "no cover": a 1x1 GIF, or an empty body, with a 200.
    const fetchImpl = serve(async () => new Response(new ArrayBuffer(43)))

    expect(await downloadCover(openLibraryCover(ISBN), ISBN, dir, asFetch(fetchImpl))).toBe('')
    expect(files()).toHaveLength(0)
  })

  it('stores nothing when a 200 carries an error page', async () => {
    const fetchImpl = serve(async () => new Response(`<html>${'sorry '.repeat(400)}</html>`))

    expect(await downloadCover(openLibraryCover(ISBN), ISBN, dir, asFetch(fetchImpl))).toBe('')
    expect(files()).toHaveLength(0)
  })

  it('stores nothing when the image is a thumbnail rather than a cover', async () => {
    // Big enough to be a real image, too small to compare with a photograph.
    const fetchImpl = serve(async () => new Response(await image(64, 64)))

    expect(await downloadCover('https://example.test/tiny.jpg', ISBN, dir, asFetch(fetchImpl))).toBe('')
    expect(files()).toHaveLength(0)
  })

  it('returns empty rather than throwing when the network is down', async () => {
    // A missing cover must not fail the save that a person is waiting on.
    const fetchImpl = serve(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')))

    expect(await downloadCover(openLibraryCover(ISBN), ISBN, dir, asFetch(fetchImpl))).toBe('')
  })

  it('returns empty rather than throwing when the file cannot be written', async () => {
    const fetchImpl = serve(async () => new Response(await image(600, 900)))
    const missing = join(dir, 'not-a-directory')

    expect(await downloadCover('https://example.test/cover.jpg', ISBN, missing, asFetch(fetchImpl))).toBe('')
    expect(files()).toHaveLength(0)
  })
})
