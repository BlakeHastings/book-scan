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
 */

import { classify, type Classification } from './classify'

const OPEN_LIBRARY_URL = 'https://openlibrary.org/api/books'
const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json'
const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes'
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
}

function emptyResult(notes: string[] = []): LookupResult {
  return {
    found: false,
    title: '', subtitle: '', authors: [], publisher: '', published: '',
    pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
    coverUrl: '', source: '',
    classification: { isFiction: true, confidence: 'unknown', reason: 'No lookup performed.' },
    notes,
  }
}

async function getJson(
  url: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<unknown | null> {
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
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
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
  const data = (await getJson(
    OPEN_LIBRARY_URL,
    { bibkeys: key, format: 'json', jscmd: 'data' },
    timeoutMs,
  )) as Record<string, OpenLibraryData> | null

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

/** Second request, for the fields jscmd=data does not carry. */
async function fromOpenLibraryEdition(isbn: string, timeoutMs: number) {
  const data = (await getJson(
    `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`,
    {},
    timeoutMs,
  )) as OpenLibraryEdition | null
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
  const data = (await getJson(GOOGLE_BOOKS_URL, params, timeoutMs)) as
    { items?: GoogleVolume[] } | null
  const first = data?.items?.[0]
  return first ? fromGoogleVolume(first) : null
}

export interface LookupOptions {
  timeoutMs?: number
  googleApiKey?: string
  /** The edition fetch is a second request per book, so it is opt-out. */
  fetchEdition?: boolean
}

export async function lookupIsbn(
  rawIsbn: string,
  options: LookupOptions = {},
): Promise<LookupResult> {
  const timeoutMs = options.timeoutMs ?? 8000
  const apiKey = options.googleApiKey ?? ''
  const isbn = (rawIsbn ?? '').replace(/[^0-9Xx]/g, '').toUpperCase()
  if (!isbn) return emptyResult(['No ISBN to look up.'])

  const [openLibrary, google] = await Promise.all([
    fromOpenLibrary(isbn, timeoutMs),
    fromGoogleIsbn(isbn, timeoutMs, apiKey),
  ])

  if (!openLibrary && !google) {
    return emptyResult([`ISBN ${isbn} not found in either catalogue.`])
  }

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
    isbn13: openLibrary?.isbn13 || google?.isbn13 || (isbn.length === 13 ? isbn : ''),
    isbn10: openLibrary?.isbn10 || google?.isbn10 || (isbn.length === 10 ? isbn : ''),
    seriesName: edition?.seriesName ?? '',
    seriesIndex: edition?.seriesIndex ?? null,
    coverUrl: openLibrary?.coverUrl || google?.coverUrl || '',
    source: sources.join(' + '),
    classification,
    notes,
  }
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

  const data = (await getJson(
    OPEN_LIBRARY_SEARCH_URL,
    {
      title: query,
      limit: '5',
      fields: 'title,author_name,publisher,first_publish_year,number_of_pages_median,isbn,subject',
    },
    timeoutMs,
  )) as { docs?: OpenLibraryDoc[] } | null

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
  }
}
