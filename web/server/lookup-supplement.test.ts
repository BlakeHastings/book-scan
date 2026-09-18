/**
 * Four real HTTP servers stand in for Open Library, Google Books, Library of
 * Congress and K10plus, pointed at through the four `BOOKSCAN_*_URL`
 * variables `lookup.ts` and `catalogue-sru.ts` already read. Real servers
 * rather than a stubbed `fetch`, for the reason `lookup-sources.test.ts`
 * gives: what is under test includes what this process makes of a slow
 * catalogue and a wrong record, and a stub would be this file asserting
 * against its own idea of those.
 *
 * What has to hold at once: a book the first two catalogues answered fully
 * costs exactly what it cost before, since the extra two are not asked; a
 * gap is filled with where it was filled from recorded in `source` and
 * `provenance`; nothing already known is overridden and nothing is taken
 * from a record that turns out to be a different book; no author is ever
 * taken; and a supplementary catalogue that hangs cannot hold a lookup open
 * past its bound or stop it answering.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetSourceStandings, sourceStandings } from './source-watch'
import { forgetPacing } from './source-pace'
import type { LookupOptions, LookupResult } from './lookup'

const ISBN = '9780441013593'

/** What Open Library says about the book. Set per test; this is the gap. */
let openLibrarySays: 'everything' | 'no pages' | 'no genre' | 'nothing at all' = 'everything'
/** What each SRU catalogue does. */
let locDoes: 'a record' | 'no records' | 'a different book' | 'hangs' = 'a record'
let k10Does: 'a record' | 'no records' | 'a different book' | 'hangs' = 'a record'
/** The extent K10plus states, so a disagreement can be arranged. */
let k10Pages = '604 pages'

let openLibrary: Server
let google: Server
let loc: Server
let k10: Server
let lookupIsbn: (isbn: string, options?: LookupOptions) => Promise<LookupResult>

const locAsked: string[] = []
const k10Asked: string[] = []

function marc(title: string, extent: string, heading: string): string {
  return '<?xml version="1.0"?><searchRetrieveResponse ' +
    'xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>1</numberOfRecords>' +
    '<records><record><recordData>' +
    '<record xmlns="http://www.loc.gov/MARC21/slim">' +
    // An author and an illustrator, exactly as a real record carries them, so
    // "no author is taken" is proved against a record that offered two.
    '<datafield tag="100" ind1="1" ind2=" "><subfield code="a">Herbert, Frank.</subfield></datafield>' +
    '<datafield tag="700" ind1="1" ind2=" "><subfield code="a">Schoenherr, John,</subfield>' +
    '<subfield code="e">illustrator.</subfield></datafield>' +
    `<datafield tag="245" ind1="1" ind2="0"><subfield code="a">${title}</subfield></datafield>` +
    `<datafield tag="300" ind1=" " ind2=" "><subfield code="a">${extent}</subfield></datafield>` +
    `<datafield tag="655" ind1=" " ind2="7"><subfield code="a">${heading}</subfield></datafield>` +
    '</record></recordData></record></records></searchRetrieveResponse>'
}

const NO_RECORDS = '<?xml version="1.0"?><searchRetrieveResponse ' +
  'xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>0</numberOfRecords>' +
  '</searchRetrieveResponse>'

function sru(
  does: typeof locDoes,
  body: string,
  res: ServerResponse,
): void {
  if (does === 'hangs') return
  res.writeHead(200, { 'Content-Type': 'application/xml' })
  res.end(does === 'no records' ? NO_RECORDS : body)
}

async function listening(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

beforeAll(async () => {
  openLibrary = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/api/books') {
      const key = url.searchParams.get('bibkeys') ?? ''
      if (openLibrarySays === 'nothing at all') return json(res, {})
      json(res, {
        [key]: {
          title: 'Dune',
          authors: [{ name: 'Frank Herbert' }],
          publishers: [{ name: 'Ace' }],
          publish_date: '1990',
          ...(openLibrarySays === 'no pages' ? {} : { number_of_pages: 535 }),
          identifiers: { isbn_13: [ISBN], isbn_10: ['0441013597'] },
          // "Paperback" and "In library" are real Open Library subjects that
          // say nothing at all about whether a book is fiction.
          subjects: (openLibrarySays === 'no genre'
            ? ['Paperback', 'In library']
            : ['Science fiction']).map((name) => ({ name })),
        },
      })
      return
    }

    if (url.pathname.startsWith('/isbn/')) {
      json(res, { series: ['Dune (1)'] })
      return
    }

    res.writeHead(404).end('{}')
  })

  // Google Books answers 429 throughout, reflecting the real catalogue, so
  // the gap under test is a real gap rather than one arranged around a
  // source that would have filled it.
  google = createServer((_req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }))
  })

  loc = createServer((req, res) => {
    locAsked.push(req.url ?? '')
    sru(
      locDoes,
      locDoes === 'a different book'
        ? marc('Sandworms of Dune', '494 p.', 'Science fiction.')
        : marc('Dune /', 'xii, 535 p. ;', 'Science fiction.'),
      res,
    )
  })

  k10 = createServer((req, res) => {
    k10Asked.push(req.url ?? '')
    sru(
      k10Does,
      k10Does === 'a different book'
        ? marc('Дюна', '480 Seiten', 'Science fiction.')
        : marc('Dune', k10Pages, 'Science fiction.'),
      res,
    )
  })

  process.env.BOOKSCAN_OPENLIBRARY_URL = await listening(openLibrary)
  process.env.BOOKSCAN_GOOGLE_BOOKS_URL = await listening(google)
  process.env.BOOKSCAN_LOC_SRU_URL = await listening(loc)
  process.env.BOOKSCAN_K10PLUS_SRU_URL = await listening(k10)
  process.env.BOOKSCAN_SRU_PACE_MS = '0'

  lookupIsbn = (await import('./lookup')).lookupIsbn
})

afterAll(async () => {
  for (const server of [openLibrary, google, loc, k10]) {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const name of [
    'BOOKSCAN_OPENLIBRARY_URL', 'BOOKSCAN_GOOGLE_BOOKS_URL',
    'BOOKSCAN_LOC_SRU_URL', 'BOOKSCAN_K10PLUS_SRU_URL', 'BOOKSCAN_SRU_PACE_MS',
  ]) delete process.env[name]
})

beforeEach(() => {
  openLibrarySays = 'everything'
  locDoes = 'a record'
  k10Does = 'a record'
  k10Pages = '604 pages'
  locAsked.length = 0
  k10Asked.length = 0
  forgetSourceStandings()
  forgetPacing()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const standingFor = (source: string) => sourceStandings().find((one) => one.source === source)!
const warnings = () => vi.mocked(console.warn).mock.calls.flat().join('\n')

describe('a book the first two catalogues answered fully', () => {
  it('costs exactly what it cost before, and asks nobody else', async () => {
    /*
     * Most books already have what they need from the first two catalogues,
     * so this keeps the same requests, the same deadline and the same
     * answer for them: nothing spent of two free national catalogues' rate
     * limits on a book with nothing to gain.
     */
    const found = await lookupIsbn(ISBN)

    expect(found.pages).toBe('535')
    expect(found.classification.genre).toBe('genre/fiction')
    expect(found.source).toBe('Open Library')
    expect(found.provenance).toBeUndefined()

    expect(locAsked).toEqual([])
    expect(k10Asked).toEqual([])
    expect(standingFor('Library of Congress')).toMatchObject({ asked: 0, skipped: 0 })
    expect(standingFor('K10plus')).toMatchObject({ asked: 0, skipped: 0 })
  })

  it('asks nobody when the caller says not to, even with a gap', async () => {
    // `settleAmbiguity` and the cover backfill both do this. Neither can use a
    // page count or a heading, and spending somebody else's rate limit to fetch
    // one for the bin is what a rate limit is there to prevent.
    openLibrarySays = 'no pages'

    const found = await lookupIsbn(ISBN, { supplement: false })

    expect(found.found).toBe(true)
    expect(found.pages).toBe('')
    expect(locAsked).toEqual([])
    expect(k10Asked).toEqual([])
  })

  it('asks nobody about a book neither of the first two has', async () => {
    /*
     * The supplement can never introduce a book, only add to one. Google Books
     * is on 429 and Open Library has no record, so there is no title to verify a
     * MARC record against and nothing that could be believed if one arrived.
     */
    openLibrarySays = 'nothing at all'

    const found = await lookupIsbn(ISBN)

    expect(found.found).toBe(false)
    expect(locAsked).toEqual([])
    expect(k10Asked).toEqual([])
  })
})

describe('a book with no page count', () => {
  it('gains one, and says which catalogue it came from', async () => {
    openLibrarySays = 'no pages'

    const found = await lookupIsbn(ISBN)

    expect(found.pages).toBe('535')
    // `source` becomes `books.lookup_source`, extending what exists rather
    // than inventing a second notion of provenance.
    expect(found.source).toBe('Open Library + Library of Congress')
    expect(found.provenance).toMatchObject({
      pages: 'Library of Congress',
      verified: ['Library of Congress', 'K10plus'],
      rejected: [],
    })
  })

  it('settles a disagreement by rank and records that there was one', async () => {
    openLibrarySays = 'no pages'
    k10Pages = '604 pages'

    const found = await lookupIsbn(ISBN)

    expect(found.pages).toBe('535')
    expect(found.provenance?.pages).toBe('Library of Congress')
    expect(found.provenance?.pagesDisagreedWith).toEqual(['K10plus'])
  })

  it('falls to the second catalogue when the first has no record', async () => {
    openLibrarySays = 'no pages'
    locDoes = 'no records'

    const found = await lookupIsbn(ISBN)

    expect(found.pages).toBe('604')
    expect(found.source).toBe('Open Library + K10plus')
    // Answering with nothing is the ordinary case, not a failure, so the
    // standing says it answered and nothing about it reaches the log. The
    // one line that is there is Google Books on 429, a source that did not
    // reply.
    expect(standingFor('Library of Congress')).toMatchObject({ asked: 1, answered: 1, silent: 0 })
    expect(warnings()).not.toContain('Library of Congress')
    expect(warnings()).toContain('Google Books')
  })

  it('takes nothing from a record that is a different book', async () => {
    /*
     * Library of Congress answers about `Sandworms of Dune` and K10plus
     * about a Russian translation; both are indexed under this ISBN and
     * neither is this book, so this lookup ends where it started, with no
     * page count.
     */
    openLibrarySays = 'no pages'
    locDoes = 'a different book'
    k10Does = 'a different book'

    const found = await lookupIsbn(ISBN)

    expect(found.pages).toBe('')
    expect(found.source).toBe('Open Library')
    expect(found.provenance).toMatchObject({
      pages: '',
      verified: [],
      rejected: ['Library of Congress', 'K10plus'],
    })
  })
})

describe('a book nobody has classified', () => {
  it('gains a genre, and the reason names who stated it', async () => {
    /*
     * A genre is written only when a source states one, and Open Library's
     * "Paperback" and "In library" state nothing, so this is a book that
     * would otherwise sit waiting for a person.
     */
    openLibrarySays = 'no genre'

    const found = await lookupIsbn(ISBN)

    expect(found.classification.genre).toBe('genre/fiction')
    expect(found.classification.reason).toContain('Library of Congress')
    // The sentence asking a person to settle it is gone, because it has been
    // settled.
    expect(found.notes).toEqual([])
    expect(found.provenance?.genre).toEqual(['Library of Congress', 'K10plus'])
  })

  it('keeps the headings where the tag rules will see them', async () => {
    /*
     * In front of Open Library's, not behind them: `claimsFrom` keeps only
     * the first SUBJECT_LIMIT headings, since a book carrying hundreds of
     * tags is a book with no tags, and these are the ones already checked
     * against the title before being believed.
     */
    openLibrarySays = 'no genre'

    const found = await lookupIsbn(ISBN)

    expect(found.subjects?.[0]).toBe('Science fiction')
    expect(found.subjects).toContain('Paperback')
  })

  it('still asks a person when no catalogue anywhere says anything', async () => {
    openLibrarySays = 'no genre'
    locDoes = 'no records'
    k10Does = 'no records'

    const found = await lookupIsbn(ISBN)

    expect(found.classification.genre).toBeNull()
    expect(found.notes).toEqual(['Fiction or non-fiction could not be determined. Please set it.'])
  })
})

describe('what is never taken', () => {
  it('credits nobody the extra catalogues named, however many names they sent', async () => {
    /*
     * Both MARC records carry an author in 100 and an illustrator in 700,
     * and neither reaches this application: `catalogue-sru.ts` does not
     * read either field, so there is no name in this process to put on a
     * book by mistake.
     */
    openLibrarySays = 'no pages'

    const found = await lookupIsbn(ISBN)

    expect(found.authors).toEqual(['Frank Herbert'])
    expect(JSON.stringify(found)).not.toContain('Schoenherr')
  })

  it('does not let a supplementary record restate the title', async () => {
    // Library of Congress writes `Dune /` with its ISBD punctuation attached.
    // The record's title is what verifies it and nothing else.
    openLibrarySays = 'no pages'

    const found = await lookupIsbn(ISBN)

    expect(found.title).toBe('Dune')
  })

  it('does not touch a page count that is already there', async () => {
    /*
     * A supplement fills a gap and never overrides: the proof is that
     * neither catalogue is asked at all once a page count is already on the
     * book.
     */
    openLibrarySays = 'no genre'
    k10Pages = '999 pages'

    const found = await lookupIsbn(ISBN)

    expect(found.pages).toBe('535')
    expect(found.provenance?.pages).toBe('')
  })
})

describe('a supplementary catalogue that hangs', () => {
  it('cannot hold the lookup open, and cannot stop it answering', async () => {
    /*
     * Proved by making a catalogue answer nothing at all: the lookup still
     * returns everything the other three said, and the wait is the
     * supplement's own bound rather than a lookup that never finishes.
     */
    openLibrarySays = 'no pages'
    locDoes = 'hangs'
    const started = Date.now()

    const found = await lookupIsbn(ISBN)

    expect(Date.now() - started).toBeLessThan(8000)
    expect(found.found).toBe(true)
    expect(found.title).toBe('Dune')
    expect(found.pages).toBe('604')
    expect(found.source).toBe('Open Library + K10plus')
    expect(standingFor('Library of Congress'))
      .toMatchObject({ asked: 1, answered: 0, silent: 1, lastSilence: 'timed out' })
  })

  it('leaves the book exactly as the first two catalogues left it when both hang', async () => {
    openLibrarySays = 'no pages'
    locDoes = 'hangs'
    k10Does = 'hangs'

    const found = await lookupIsbn(ISBN)

    expect(found.found).toBe(true)
    expect(found.pages).toBe('')
    expect(found.source).toBe('Open Library')
    expect(found.provenance).toMatchObject({ verified: [], rejected: [] })
  })
})
