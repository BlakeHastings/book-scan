/**
 * Metadata lookup, ported from bookscan/lookup.py.
 *
 * Open Library is primary; Google Books is a top-up and fallback only. Its
 * anonymous quota is per-IP and starts returning 429 well before you finish a
 * shelf, so nothing here may depend on it.
 *
 * Two additions over the Python version: `subjects` and `categories` are now
 * kept rather than parsed past (they drive classification and were already in
 * the responses), and the Open Library edition record is fetched for series
 * and Dewey.
 *
 * **Since #348, a catalogue that does not answer says so.** It says it to
 * `source-watch.ts` rather than to the caller: what a successful lookup returns
 * is exactly what it returned before, because every screen and every save path
 * was built against that. What changed is that "Google Books answered 429 and
 * the failure was absorbed" is now a line in the log and a counter on
 * `/api/health` instead of nothing at all, which is how it went unnoticed for
 * the whole life of the catalogue. Read the header of that file before changing
 * anything here: the distinction it turns on is between a source with no record
 * of a book, which is ordinary, and a source that did not reply.
 */

import { classify, type Classification } from './classify'
import { noteSourceAnswer } from './source-watch'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { normaliseIsbn, resolveIsbnPair } from '../shared/isbn'

/*
 * Where the catalogues live.
 *
 * The origins are read from the environment so a test run can point them at a
 * local stub. Nothing sets them in normal use, and the fallbacks are the real
 * services, so a developer or a phone on the shelf is unaffected. This exists
 * because the lookups happen in this process, not the browser: an end to end
 * run cannot intercept them from the page, and a suite that really talks to
 * Open Library fails whenever Open Library is slow or down.
 */
const OPEN_LIBRARY_ORIGIN = process.env.BOOKSCAN_OPENLIBRARY_URL || 'https://openlibrary.org'
const GOOGLE_BOOKS_ORIGIN = process.env.BOOKSCAN_GOOGLE_BOOKS_URL || 'https://www.googleapis.com'

const OPEN_LIBRARY_URL = `${OPEN_LIBRARY_ORIGIN}/api/books`
const OPEN_LIBRARY_SEARCH_URL = `${OPEN_LIBRARY_ORIGIN}/search.json`
const GOOGLE_BOOKS_URL = `${GOOGLE_BOOKS_ORIGIN}/books/v1/volumes`
const USER_AGENT = 'book-scan-web/0.1 (personal library cataloguing)'

export interface LookupResult {
  found: boolean
  title: string
  subtitle: string
  authors: string[]
  publisher: string
  published: string
  pages: string
  isbn13: string
  isbn10: string
  seriesName: string
  seriesIndex: number | null
  coverUrl: string
  source: string
  classification: Classification
  notes: string[]
  /**
   * The headings the catalogues actually sent, kept rather than consumed.
   *
   * They already came back in the responses and already drove classification;
   * what is new since #179 is that a caller can turn them into tags, which needs
   * the strings and not only the fiction verdict they were reduced to. Optional
   * because a result assembled before that existed is still a result: the two
   * are read as "nothing was said", never as "nothing was found".
   */
  subjects?: string[]
  categories?: string[]
}

function emptyResult(notes: string[] = []): LookupResult {
  return {
    found: false,
    title: '', subtitle: '', authors: [], publisher: '', published: '',
    pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
    coverUrl: '', source: '',
    classification: { genre: FICTION_SLUG, confidence: 'unknown', reason: 'No lookup performed.' },
    notes,
  }
}

/**
 * What came back from one request, which is three outcomes and not two (#348).
 *
 * `data` being null while `answered` is true is the ordinary case: the
 * catalogue replied and has nothing about this book. `answered` being false is
 * the catalogue not replying at all, which until #348 was the same `null` and
 * so was indistinguishable from it.
 */
interface Answer {
  /** True when the catalogue replied, whatever it said. */
  answered: boolean
  /** What it said, parsed, or null when it said nothing usable. */
  data: unknown | null
  /**
   * Why it did not reply, from the closed vocabulary `source-watch.ts` accepts.
   *
   * **Built from the status code and nothing else, deliberately.** The request
   * this describes carries the API key in its query string, so a reason made by
   * stringifying the error, the response or the URL would carry the key into
   * `/api/health` and into the log. Do not widen this to the response body
   * either: it is somebody else's text and it reaches a diagnostic.
   */
  why: string
}

async function getJson(
  url: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<Answer> {
  const target = new URL(url)
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    })
    // 404 is the catalogue answering. Neither of these endpoints uses it for a
    // book it does not hold, but a source that did would be stating an absence
    // rather than failing, so it is not counted as silence either way.
    if (!response.ok) {
      return { answered: response.status === 404, data: null, why: `HTTP ${response.status}` }
    }
    return { answered: true, data: await response.json(), why: '' }
  } catch (error) {
    /*
     * Two shapes reach here and they mean different things to whoever reads the
     * report. An abort is this process giving up on a catalogue that was too
     * slow; anything else is the request never completing at all, which is DNS,
     * TLS, a refused connection or a body that was not JSON. Neither carries
     * anything from the error itself, for the reason on `why` above.
     */
    const aborted = error instanceof Error && error.name === 'AbortError'
    return { answered: false, data: null, why: aborted ? 'timed out' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

function cleanSeriesName(value: string): string {
  return value.replace(/^[\s,;:#-]+/, '').replace(/[\s,;:#-]+$/, '').trim()
}

/**
 * Series strings from Open Library are free text and frequently pack more than
 * one designation into a single field. A real example, for Dune:
 *
 *     "Dune (1); Dune Chronicles, Book 1"
 *
 * So: take the first semicolon-separated designation as the primary series,
 * then peel a trailing number off it. Falls back to scanning the whole string
 * when the first designation carries no number.
 *
 * The bare-number form ("Discworld 5") is deliberately not matched. Requiring
 * an explicit separator costs a few missing indexes, which the user can type
 * in, and avoids mangling a series whose name genuinely ends in a number.
 * A wrong series name splits a series across the shelf; a missing index does
 * not.
 */
export function parseSeries(raw: string): { name: string; index: number | null } {
  const value = (raw ?? '').trim()
  if (!value) return { name: '', index: null }

  const primary = value.split(';')[0]?.trim() || value

  const patterns = [
    /^(.*?)\s*\((\d+(?:\.\d+)?)\)$/,                       // Dune (1)
    /^(.*?)[\s,]*(?:#|no\.?|nr\.?|bk\.?|book|vol\.?|volume|part)\s*(\d+(?:\.\d+)?)$/i,
    /^(.*?)[,;:-]\s*(\d+(?:\.\d+)?)$/,                     // Discworld ; 5
  ]

  for (const source of [primary, value]) {
    for (const pattern of patterns) {
      const match = pattern.exec(source.trim())
      const name = cleanSeriesName(match?.[1] ?? '')
      if (match?.[2] && name) {
        return { name, index: Number.parseFloat(match[2]) }
      }
    }
  }

  return { name: cleanSeriesName(primary), index: null }
}

interface OpenLibraryData {
  title?: string
  subtitle?: string
  authors?: { name?: string }[]
  publishers?: { name?: string }[]
  publish_date?: string
  number_of_pages?: number
  identifiers?: { isbn_13?: string[]; isbn_10?: string[] }
  subjects?: { name?: string }[]
  cover?: { medium?: string; large?: string }
}

async function fromOpenLibrary(isbn: string, timeoutMs: number) {
  const key = `ISBN:${isbn}`
  const answer = await getJson(
    OPEN_LIBRARY_URL,
    { bibkeys: key, format: 'json', jscmd: 'data' },
    timeoutMs,
  )
  noteSourceAnswer('Open Library', answer.answered, answer.why)
  const data = answer.data as Record<string, OpenLibraryData> | null

  const entry = data?.[key]
  if (!entry?.title) return null

  return {
    title: entry.title ?? '',
    subtitle: entry.subtitle ?? '',
    authors: (entry.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
    publisher: (entry.publishers ?? []).map((p) => p.name ?? '').filter(Boolean).join(', '),
    published: entry.publish_date ?? '',
    pages: entry.number_of_pages ? String(entry.number_of_pages) : '',
    isbn13: entry.identifiers?.isbn_13?.[0] ?? '',
    isbn10: entry.identifiers?.isbn_10?.[0] ?? '',
    subjects: (entry.subjects ?? []).map((s) => s.name ?? '').filter(Boolean),
    coverUrl: entry.cover?.large ?? entry.cover?.medium ?? '',
  }
}

interface OpenLibraryEdition {
  series?: string[]
  dewey_decimal_class?: string[]
  lc_classifications?: string[]
}

/**
 * Second request, for the fields jscmd=data does not carry.
 *
 * **Deliberately not counted in the source report.** It is a second request to
 * a catalogue this lookup has already recorded an answer from, and counting it
 * would double Open Library's `asked` against Google Books' one, so "asked"
 * would stop meaning "consulted about a book". A source that is down fails the
 * primary request too, and that one is counted.
 */
async function fromOpenLibraryEdition(isbn: string, timeoutMs: number) {
  const data = (await getJson(
    `${OPEN_LIBRARY_ORIGIN}/isbn/${encodeURIComponent(isbn)}.json`,
    {},
    timeoutMs,
  )).data as OpenLibraryEdition | null
  if (!data) return null

  const series = parseSeries(data.series?.[0] ?? '')
  return {
    seriesName: series.name,
    seriesIndex: series.index,
    dewey: data.dewey_decimal_class ?? [],
    lc: data.lc_classifications ?? [],
  }
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    publisher?: string
    publishedDate?: string
    pageCount?: number
    categories?: string[]
    industryIdentifiers?: { type?: string; identifier?: string }[]
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
  }
}

function fromGoogleVolume(volume: GoogleVolume) {
  const info = volume.volumeInfo ?? {}
  let isbn13 = ''
  let isbn10 = ''
  for (const id of info.industryIdentifiers ?? []) {
    if (id.type === 'ISBN_13') isbn13 = id.identifier ?? ''
    if (id.type === 'ISBN_10') isbn10 = id.identifier ?? ''
  }

  return {
    title: info.title ?? '',
    subtitle: info.subtitle ?? '',
    authors: info.authors ?? [],
    publisher: info.publisher ?? '',
    published: info.publishedDate ?? '',
    pages: info.pageCount ? String(info.pageCount) : '',
    isbn13,
    isbn10,
    categories: info.categories ?? [],
    coverUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? '',
  }
}

async function fromGoogleIsbn(isbn: string, timeoutMs: number, apiKey: string) {
  const params: Record<string, string> = { q: `isbn:${isbn}` }
  if (apiKey) params.key = apiKey
  const answer = await getJson(GOOGLE_BOOKS_URL, params, timeoutMs)
  noteSourceAnswer('Google Books', answer.answered, answer.why)
  const data = answer.data as { items?: GoogleVolume[] } | null
  const first = data?.items?.[0]
  return first ? fromGoogleVolume(first) : null
}

export interface LookupOptions {
  timeoutMs?: number
  googleApiKey?: string
  /** The edition fetch is a second request per book, so it is opt-out. */
  fetchEdition?: boolean
}

/**
 * Look a single ISBN form up. Returns null when neither catalogue has it, so
 * the caller can try the other form.
 */
async function lookupOne(
  isbn: string,
  options: LookupOptions,
): Promise<LookupResult | null> {
  const timeoutMs = options.timeoutMs ?? 8000
  const apiKey = options.googleApiKey ?? ''

  /*
   * Both catalogues, and each of them has already told `source-watch.ts` what
   * it did by the time this line finishes (#348). Nothing below reads that: a
   * source going quiet must not change the answer, must not add a note in front
   * of somebody holding a book, and must not stop the other source from being
   * the answer. What it changes is that the fact is now recorded rather than
   * absorbed, and `/api/health` will say so.
   */
  const [openLibrary, google] = await Promise.all([
    fromOpenLibrary(isbn, timeoutMs),
    fromGoogleIsbn(isbn, timeoutMs, apiKey),
  ])

  if (!openLibrary && !google) return null

  const edition =
    options.fetchEdition === false ? null : await fromOpenLibraryEdition(isbn, timeoutMs)

  const notes: string[] = []
  const sources: string[] = []
  if (openLibrary) sources.push('Open Library')
  if (google) sources.push('Google Books')

  const classification = classify({
    categories: google?.categories,
    subjects: openLibrary?.subjects,
    deweyDecimal: edition?.dewey,
    lcClassifications: edition?.lc,
  })

  if (classification.confidence === 'unknown') {
    notes.push('Fiction or non-fiction could not be determined. Please set it.')
  }

  return {
    found: true,
    title: openLibrary?.title || google?.title || '',
    subtitle: openLibrary?.subtitle || google?.subtitle || '',
    authors: (openLibrary?.authors?.length ? openLibrary.authors : google?.authors) ?? [],
    publisher: openLibrary?.publisher || google?.publisher || '',
    published: openLibrary?.published || google?.published || '',
    pages: openLibrary?.pages || google?.pages || '',
    isbn13: openLibrary?.isbn13 || google?.isbn13 || '',
    isbn10: openLibrary?.isbn10 || google?.isbn10 || '',
    seriesName: edition?.seriesName ?? '',
    seriesIndex: edition?.seriesIndex ?? null,
    coverUrl: openLibrary?.coverUrl || google?.coverUrl || '',
    source: sources.join(' + '),
    classification,
    notes,
    subjects: openLibrary?.subjects ?? [],
    categories: google?.categories ?? [],
  }
}

export async function lookupIsbn(
  rawIsbn: string,
  options: LookupOptions = {},
): Promise<LookupResult> {
  const pair = resolveIsbnPair(rawIsbn)

  // Both forms are tried, in that order. A catalogue indexes an edition under
  // whichever ISBN it was issued with, so an older book registered only under
  // its 10-digit ISBN is invisible to a 13-only search, and vice versa.
  const candidates = [pair.isbn13, pair.isbn10].filter(Boolean)

  if (!candidates.length) {
    const raw = normaliseIsbn(rawIsbn)
    if (!raw) return emptyResult(['No ISBN to look up.'])
    // Not a valid ISBN in either length. Manual entry still gets one attempt
    // rather than being refused outright, but it is flagged.
    const loose = await lookupOne(raw, options)
    return loose
      ? { ...loose, notes: [...loose.notes, `"${raw}" is not a valid ISBN. Please verify this is the right book.`] }
      : emptyResult([`"${raw}" is not a valid ISBN-10 or ISBN-13.`])
  }

  for (const [index, candidate] of candidates.entries()) {
    const found = await lookupOne(candidate, options)
    if (!found) continue

    const notes = [...found.notes]
    if (index > 0) {
      notes.push(`Found under the 10-digit ISBN ${candidate}, not the 13-digit form.`)
    }

    // Always carry both forms. Prefer what was scanned, since that is the
    // copy in hand, and fall back to whatever the catalogue reported.
    return {
      ...found,
      isbn13: pair.isbn13 || found.isbn13,
      isbn10: pair.isbn10 || found.isbn10,
      notes,
    }
  }

  return emptyResult([
    `ISBN ${candidates.join(' / ')} not found in either catalogue.`,
  ])
}

interface OpenLibraryDoc {
  title?: string
  author_name?: string[]
  publisher?: string[]
  first_publish_year?: number
  number_of_pages_median?: number
  isbn?: string[]
  subject?: string[]
}

/** Fallback for books with no readable barcode. */
export async function searchTitle(
  title: string,
  options: LookupOptions = {},
): Promise<LookupResult> {
  const timeoutMs = options.timeoutMs ?? 8000
  const query = (title ?? '').trim()
  if (query.length < 3) return emptyResult(['Title too short to search.'])

  const answer = await getJson(
    OPEN_LIBRARY_SEARCH_URL,
    {
      title: query,
      limit: '5',
      fields: 'title,author_name,publisher,first_publish_year,number_of_pages_median,isbn,subject',
    },
    timeoutMs,
  )
  // The one catalogue this route asks, counted the same way, so a search that
  // came back empty because Open Library was down is not filed as a collection
  // with no such book in it.
  noteSourceAnswer('Open Library', answer.answered, answer.why)
  const data = answer.data as { docs?: OpenLibraryDoc[] } | null

  const doc = data?.docs?.[0]
  if (!doc?.title) return emptyResult([`No match for title "${query}".`])

  const isbns = doc.isbn ?? []
  const classification = classify({ subjects: (doc.subject ?? []).slice(0, 40) })

  return {
    found: true,
    title: doc.title,
    subtitle: '',
    authors: doc.author_name ?? [],
    publisher: (doc.publisher ?? []).slice(0, 2).join(', '),
    published: doc.first_publish_year ? String(doc.first_publish_year) : '',
    pages: doc.number_of_pages_median ? String(doc.number_of_pages_median) : '',
    isbn13: isbns.find((i) => i.length === 13) ?? '',
    isbn10: isbns.find((i) => i.length === 10) ?? '',
    seriesName: '',
    seriesIndex: null,
    coverUrl: '',
    source: 'Open Library search',
    classification,
    notes: [`Matched by title "${query}", not by ISBN. Please verify.`],
    subjects: (doc.subject ?? []).slice(0, 40),
    categories: [],
  }
}
