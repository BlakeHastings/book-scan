/**
 * A stand-in for Open Library and Google Books.
 *
 * Both lookups happen in the API process, not the browser, so the page cannot
 * intercept them and neither can Playwright's routing. The server reads its
 * catalogue origins from the environment (see web/server/lookup.ts), so the
 * suite starts this and points the app at it.
 *
 * This is not an optimisation. A suite that really asks Open Library fails
 * whenever Open Library is slow, rate limiting, or down, and it fails in a way
 * that looks exactly like the app being broken. Answering here means a run has
 * only one possible reason to go red, which is the app.
 *
 * One server serves all three origins. Their paths do not collide, and one
 * port is one thing to shut down.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { ALL_STUB_BOOKS, type StubBook } from './books.js'

export interface CatalogueStub {
  /** Origin to hand to every BOOKSCAN_*_URL variable. */
  url: string
  /** Every path asked for, in order. Useful when a lookup does not fire. */
  requests: string[]
  /** Paths this stub had no answer for. Should stay empty. */
  unknown: string[]
  close: () => Promise<void>
}

/**
 * A delay armed for the next lookup of one ISBN, so a test can hold a
 * relookup open for as long as it needs to assert on what the app does while
 * one is still running.
 *
 * `remaining` starts at two because `lookupOne` fires Open Library and Google
 * Books together with `Promise.all`: both legs have to be held up, or the one
 * left alone answers immediately and the lookup as a whole is not actually
 * slow. It counts down as each matching request is served and clears itself
 * once both have gone, so it never lingers to catch a lookup nobody armed it
 * for.
 */
interface PendingDelay {
  isbn: string
  ms: number
  remaining: number
}

/** Digits and check character only, uppercased, so any form of the same ISBN compares equal. */
function normalise(isbn: string): string {
  return isbn.replace(/[^0-9Xx]/g, '').toUpperCase()
}

function byIsbn(isbn: string): StubBook | undefined {
  const digits = normalise(isbn)
  return ALL_STUB_BOOKS.find(
    (book) => book.isbn13 === digits || book.isbn10 === digits,
  )
}

/** The shape Open Library returns for `jscmd=data`. */
function openLibraryData(book: StubBook) {
  return {
    title: book.title,
    authors: book.authors.map((name) => ({ name })),
    publishers: [{ name: book.publisher }],
    publish_date: book.published,
    number_of_pages: Number(book.pages),
    identifiers: { isbn_13: [book.isbn13], isbn_10: [book.isbn10] },
    subjects: book.subjects.map((name) => ({ name })),
    // No cover: this stub serves no artwork, so the app finds none and stamps
    // the book as asked-about, which is a real state the app has to handle.
    cover: {},
  }
}

/** The shape Google Books returns for `q=isbn:...`. */
function googleVolume(book: StubBook) {
  return {
    items: [
      {
        volumeInfo: {
          title: book.title,
          authors: book.authors,
          publisher: book.publisher,
          publishedDate: book.published,
          pageCount: Number(book.pages),
          categories: book.categories,
          industryIdentifiers: [
            { type: 'ISBN_13', identifier: book.isbn13 },
            { type: 'ISBN_10', identifier: book.isbn10 },
          ],
        },
      },
    ],
  }
}

export async function startCatalogueStub(): Promise<CatalogueStub> {
  const requests: string[] = []
  const unknown: string[] = []
  let pendingDelay: PendingDelay | null = null

  /**
   * How long to hold this ISBN's answer up, consuming one use of whatever
   * delay is armed. Zero for everything else, which is every request outside
   * the one scenario that arms this.
   */
  function delayFor(isbn: string): number {
    if (!pendingDelay || pendingDelay.isbn !== isbn) return 0
    const ms = pendingDelay.ms
    pendingDelay.remaining -= 1
    if (pendingDelay.remaining <= 0) pendingDelay = null
    return ms
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://stub.invalid')

    // A test's own control call, not a lookup, so it is answered before the
    // request log and the lookup routes below ever see it.
    if (request.method === 'POST' && url.pathname === '/__control/delay-next-lookup') {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk })
      request.on('end', () => {
        const { isbn13, ms } = JSON.parse(body || '{}') as { isbn13?: string; ms?: number }
        const isbn = normalise(isbn13 ?? '')
        pendingDelay = isbn && ms ? { isbn, ms, remaining: 2 } : null
        response.writeHead(204)
        response.end()
      })
      return
    }

    requests.push(url.pathname + url.search)

    const json = (body: unknown) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    const missing = () => {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('not here')
    }

    // Open Library: the metadata call.
    if (url.pathname === '/api/books') {
      const key = url.searchParams.get('bibkeys') ?? ''
      const isbn = normalise(key.replace(/^ISBN:/, ''))
      const book = byIsbn(isbn)
      const send = () => json(book ? { [key]: openLibraryData(book) } : {})
      const wait = delayFor(isbn)
      if (wait > 0) setTimeout(send, wait); else send()
      return
    }

    // Open Library: the edition record, for series and Dewey.
    const edition = /^\/isbn\/([^/]+)\.json$/.exec(url.pathname)
    if (edition) {
      const book = byIsbn(edition[1] ?? '')
      if (!book) return missing()
      // No series, and a Dewey that agrees with the categories rather than
      // fighting them, so classification cannot come out ambiguous.
      json({ series: [], dewey_decimal_class: ['813/.54'], lc_classifications: [] })
      return
    }

    // Open Library: title search, the fallback when no ISBN can be read.
    if (url.pathname === '/search.json') {
      const title = (url.searchParams.get('title') ?? '').toLowerCase()
      const book = ALL_STUB_BOOKS.find((b) => b.title.toLowerCase() === title)
      json({
        docs: book
          ? [{
              title: book.title,
              author_name: book.authors,
              publisher: [book.publisher],
              first_publish_year: Number(book.published),
              number_of_pages_median: Number(book.pages),
              isbn: [book.isbn13, book.isbn10],
              subject: book.subjects,
            }]
          : [],
      })
      return
    }

    // Google Books.
    if (url.pathname === '/books/v1/volumes') {
      const query = url.searchParams.get('q') ?? ''
      const isbn = normalise(query.replace(/^isbn:/, ''))
      const book = byIsbn(isbn)
      const send = () => json(book ? googleVolume(book) : { items: [] })
      const wait = delayFor(isbn)
      if (wait > 0) setTimeout(send, wait); else send()
      return
    }

    /*
     * The two SRU catalogues (#305), which stand in for Library of Congress and
     * K10plus. They answer a well-formed SRU response with no records in it,
     * which is a real and ordinary thing for a national catalogue to say.
     *
     * That is the whole point of them being here. The app asks these two only
     * about a book the other two left without a page count or a genre, and every
     * book in `books.ts` has both, so nothing in a green run reaches them. What
     * this stops is a run that goes off-script from reaching the real Library of
     * Congress, which is the failure this file exists to prevent, one origin
     * later than it was written for.
     */
    if (url.pathname === '/sru/lcdb' || url.pathname === '/sru/k10plus') {
      response.writeHead(200, { 'Content-Type': 'application/xml' })
      response.end(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">' +
        '<version>1.1</version><numberOfRecords>0</numberOfRecords>' +
        '</searchRetrieveResponse>',
      )
      return
    }

    // Cover artwork. Deliberately absent: a 404 is what Open Library sends
    // for a book it has no picture of, and it keeps the run off the network
    // without inventing artwork nobody asserts on.
    if (url.pathname.startsWith('/b/isbn/')) return missing()

    unknown.push(url.pathname)
    missing()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    unknown,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
