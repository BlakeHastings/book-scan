/**
 * A catalogue made to fail on purpose, and what the other one still does (#348).
 *
 * Two real HTTP servers stand in for Open Library and Google Books, pointed at
 * through `BOOKSCAN_OPENLIBRARY_URL` and `BOOKSCAN_GOOGLE_BOOKS_URL`, which are
 * the variables `lookup.ts` already reads so a test run can take the lookups off
 * the network. Real servers rather than a stubbed `fetch`, because the thing
 * under test is what `lookup.ts` makes of a status code, an abort and a dropped
 * socket, and a stub would be this file asserting against its own idea of those.
 *
 * The failure being reproduced is the one in the real catalogue:
 * `docs/catalogue-sources.md` found `lookup_source` reading
 * `Open Library + Google Books` for zero of 238 books, because Google Books has
 * answered 429 to every request ever made to it and the failure was absorbed.
 *
 * Three things have to hold at once and each has a test below:
 *
 * 1. **The lookup still succeeds from the other source.** A catalogue being
 *    down must not stop somebody cataloguing a book.
 * 2. **What a successful lookup returns does not change.** Every screen and
 *    every save path was built against it.
 * 3. **The silence is recorded**, in the log and on `/api/health`, and the API
 *    key is in neither.
 *
 * `lookup.ts` reads both origins as it is imported, so it is imported here only
 * after the servers are listening. That is also why `source-watch` is imported
 * at the top and the module registry is never reset: both files have to be
 * looking at the same tally.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { forgetSourceStandings, sourceStandings } from './source-watch'
import type { LookupOptions, LookupResult } from './lookup'

/** The key handed to a lookup, so its absence from every diagnostic is provable. */
const API_KEY = 'not-a-real-key-9d1f0c'

const ISBN = '9780441013593'

/** What each stub does with the next request. Set per test. */
let openLibraryDoes: 'answers' | 'has no record' | 'quota' | 'hangs' | 'drops' = 'answers'
let googleDoes: 'answers' | 'has no record' | 'quota' | 'hangs' | 'drops' = 'answers'

let openLibrary: Server
let google: Server
let lookupIsbn: (isbn: string, options?: LookupOptions) => Promise<LookupResult>
let searchTitle: (title: string, options?: LookupOptions) => Promise<LookupResult>

/** Everything the Google stub was actually sent, to prove what carried the key. */
const googleAsked: string[] = []

function answer(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * The four ways a catalogue can behave, mapped onto one handler.
 *
 * "has no record" is a 200 with nothing in it, which is the ordinary case and
 * the one that must never be counted as a failure.
 */
function behave(
  does: typeof googleDoes,
  req: IncomingMessage,
  res: ServerResponse,
  found: unknown,
  empty: unknown,
): void {
  if (does === 'quota') {
    // Google's own words for an exhausted anonymous pool, shortened.
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'Queries'" } }))
    return
  }
  if (does === 'hangs') return // no response at all, until the caller gives up
  if (does === 'drops') {
    req.socket.destroy()
    return
  }
  answer(res, does === 'answers' ? found : empty)
}

async function listening(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeAll(async () => {
  openLibrary = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/api/books') {
      const key = url.searchParams.get('bibkeys') ?? ''
      behave(openLibraryDoes, req, res, {
        [key]: {
          title: 'Dune',
          authors: [{ name: 'Frank Herbert' }],
          publishers: [{ name: 'Ace' }],
          publish_date: '1990',
          number_of_pages: 535,
          identifiers: { isbn_13: [ISBN], isbn_10: ['0441013597'] },
          subjects: [{ name: 'Science fiction' }],
        },
      }, {})
      return
    }

    if (url.pathname.startsWith('/isbn/')) {
      // The edition request. Deliberately not counted in the report, so it
      // always answers here and never colours a case.
      answer(res, { series: ['Dune (1)'] })
      return
    }

    if (url.pathname === '/search.json') {
      behave(openLibraryDoes, req, res, {
        docs: [{ title: 'Dune', author_name: ['Frank Herbert'], subject: ['Science fiction'] }],
      }, { docs: [] })
      return
    }

    res.writeHead(404).end('{}')
  })

  google = createServer((req, res) => {
    googleAsked.push(req.url ?? '')
    behave(googleDoes, req, res, {
      items: [{
        volumeInfo: {
          title: 'Dune',
          authors: ['Frank Herbert'],
          publisher: 'Ace',
          publishedDate: '1990-09-01',
          pageCount: 535,
          categories: ['Fiction / Science Fiction'],
          industryIdentifiers: [{ type: 'ISBN_13', identifier: ISBN }],
        },
      }],
    }, {})
  })

  process.env.BOOKSCAN_OPENLIBRARY_URL = await listening(openLibrary)
  process.env.BOOKSCAN_GOOGLE_BOOKS_URL = await listening(google)

  const module = await import('./lookup')
  lookupIsbn = module.lookupIsbn
  searchTitle = module.searchTitle
})

afterAll(async () => {
  for (const server of [openLibrary, google]) {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  delete process.env.BOOKSCAN_OPENLIBRARY_URL
  delete process.env.BOOKSCAN_GOOGLE_BOOKS_URL
})

beforeEach(() => {
  openLibraryDoes = 'answers'
  googleDoes = 'answers'
  googleAsked.length = 0
  forgetSourceStandings()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const standingFor = (source: string) => sourceStandings().find((one) => one.source === source)!
const warnings = () => vi.mocked(console.warn).mock.calls.flat().join('\n')

describe('when both catalogues answer', () => {
  it('is the answer it has always been, and both are recorded as answering', async () => {
    const found = await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    // The shape #348 must not disturb. Two sources named, joined the one way.
    expect(found.found).toBe(true)
    expect(found.source).toBe('Open Library + Google Books')
    expect(found.title).toBe('Dune')
    expect(found.pages).toBe('535')
    expect(found.seriesName).toBe('Dune')
    expect(found.notes).toEqual([])

    expect(standingFor('Open Library')).toMatchObject({ asked: 1, answered: 1, silent: 0 })
    expect(standingFor('Google Books')).toMatchObject({ asked: 1, answered: 1, silent: 0 })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('does not count a catalogue with no record of the book as a failure', async () => {
    // The ordinary case, and the reason #305 exists. Google Books answered; it
    // has never heard of this book. That is not silence.
    googleDoes = 'has no record'

    const found = await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    expect(found.found).toBe(true)
    expect(found.source).toBe('Open Library')
    expect(standingFor('Google Books')).toMatchObject({
      asked: 1, answered: 1, silent: 0, lastSilence: '',
    })
    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe('when Google Books answers 429, which is what it has always done', () => {
  it('still catalogues the book, from the source that did answer', async () => {
    googleDoes = 'quota'

    const found = await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    // The rule that outranks everything else here: a catalogue being down must
    // not stop somebody cataloguing a book.
    expect(found.found).toBe(true)
    expect(found.title).toBe('Dune')
    expect(found.authors).toEqual(['Frank Herbert'])
    expect(found.pages).toBe('535')
    expect(found.isbn13).toBe(ISBN)
    expect(found.classification.genre).not.toBeNull()

    // And it does not tell the person holding the book about it. `notes` is
    // rendered on the review form; a quota message there is a technical failure
    // put in front of somebody who cannot do anything about it.
    expect(found.notes).toEqual([])
    expect(found.source).toBe('Open Library')
  })

  it('records the silence rather than absorbing it', async () => {
    googleDoes = 'quota'

    await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    expect(standingFor('Google Books')).toMatchObject({
      asked: 1, answered: 0, silent: 1, lastSilence: 'HTTP 429',
    })
    expect(Date.parse(standingFor('Google Books').lastSilentAt)).not.toBeNaN()
    expect(standingFor('Open Library')).toMatchObject({ asked: 1, answered: 1, silent: 0 })
  })

  it('says so in the log, where it outlives the process', async () => {
    googleDoes = 'quota'

    await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    expect(warnings()).toContain('Google Books did not answer (HTTP 429)')
    expect(warnings()).toContain('/api/health')
  })

  it('puts the key in neither the log nor the report, though the request carried it', async () => {
    googleDoes = 'quota'

    await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    // The request really did carry it, so this is a live check rather than a
    // check that the code path was never taken.
    expect(googleAsked.join('\n')).toContain(API_KEY)

    expect(warnings()).not.toContain(API_KEY)
    expect(JSON.stringify(sourceStandings())).not.toContain(API_KEY)
  })
})

describe('the other ways a catalogue goes quiet', () => {
  it('calls a catalogue that never replies timed out', async () => {
    googleDoes = 'hangs'

    const found = await lookupIsbn(ISBN, { googleApiKey: API_KEY, timeoutMs: 150 })

    expect(found.found).toBe(true)
    expect(found.source).toBe('Open Library')
    expect(standingFor('Google Books')).toMatchObject({ silent: 1, lastSilence: 'timed out' })
  })

  it('calls a catalogue that drops the connection unreachable', async () => {
    googleDoes = 'drops'

    const found = await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    expect(found.found).toBe(true)
    expect(found.source).toBe('Open Library')
    expect(standingFor('Google Books')).toMatchObject({ silent: 1, lastSilence: 'unreachable' })
  })

  it('records both when neither answers, and refuses without throwing', async () => {
    openLibraryDoes = 'quota'
    googleDoes = 'quota'

    const found = await lookupIsbn(ISBN, { googleApiKey: API_KEY })

    expect(found.found).toBe(false)
    expect(found.notes[0]).toContain('not found in either catalogue')

    // Both ISBN forms are tried before it gives up, so each catalogue is asked
    // twice. Nothing here is an exception and nothing reached a 500.
    expect(standingFor('Open Library')).toMatchObject({ asked: 2, answered: 0, silent: 2 })
    expect(standingFor('Google Books')).toMatchObject({ asked: 2, answered: 0, silent: 2 })
  })
})

describe('the title search, which asks one catalogue', () => {
  it('separates a catalogue that was quiet from a collection with no such book', async () => {
    openLibraryDoes = 'quota'
    const quiet = await searchTitle('Dune')

    expect(quiet.found).toBe(false)
    expect(standingFor('Open Library')).toMatchObject({ silent: 1, lastSilence: 'HTTP 429' })

    forgetSourceStandings()
    openLibraryDoes = 'has no record'
    const nothing = await searchTitle('Dune')

    expect(nothing.found).toBe(false)
    expect(standingFor('Open Library')).toMatchObject({ answered: 1, silent: 0 })
  })
})
