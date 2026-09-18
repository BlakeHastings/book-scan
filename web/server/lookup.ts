/**
 * Metadata lookup.
 *
 * Open Library is primary; Google Books is a top-up and fallback only. Its
 * anonymous quota is per-IP and starts returning 429 well before you finish a
 * shelf, so nothing here may depend on it.
 *
 * A catalogue that does not answer says so to `source-watch.ts` rather than to
 * the caller, and nothing a successful lookup returns depends on it. Read that
 * file's header before changing anything here: the distinction it turns on is
 * between a source with no record of a book, which is ordinary, and a source that
 * did not reply. `noteSourceAnswer` takes an outcome and not a boolean, which is
 * why every call to it here sits below the parse rather than above it.
 *
 * Two of the four catalogues are a top-up, asked through `catalogue-sru.ts`, and
 * what may be taken from them is decided by
 * `domain/books/catalogue-reconciliation.ts`. Three rules about how they are
 * asked: only about a book the first two left a gap in, meaning no page count or
 * no stated genre; inside the same call rather than deferred to a later pass; and
 * never for longer than the bound on them, both at once under
 * `SUPPLEMENT_TIMEOUT_MS`, with the round skipped outright wherever there is
 * nothing to gain.
 */

import { classify, type Classification } from './classify'
import { noteSourceAnswer, outcomeOf } from './source-watch'
import { askSupplementaryCatalogues } from './catalogue-sru'
import { fetchBounded, type Answer } from './bounded-fetch'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { reconcile, type Reconciliation } from '../domain/books/catalogue-reconciliation'
import { normaliseIsbn, resolveIsbnPair } from '../shared/isbn'

/*
 * The origins are read from the environment so a test run can point them at a
 * local stub, since the lookups happen in this process rather than the browser
 * and an end to end run cannot intercept them from the page. Nothing sets them in
 * normal use.
 */
const OPEN_LIBRARY_ORIGIN = process.env.BOOKSCAN_OPENLIBRARY_URL || 'https://openlibrary.org'
const GOOGLE_BOOKS_ORIGIN = process.env.BOOKSCAN_GOOGLE_BOOKS_URL || 'https://www.googleapis.com'

const OPEN_LIBRARY_URL = `${OPEN_LIBRARY_ORIGIN}/api/books`
const OPEN_LIBRARY_SEARCH_URL = `${OPEN_LIBRARY_ORIGIN}/search.json`
const GOOGLE_BOOKS_URL = `${GOOGLE_BOOKS_ORIGIN}/books/v1/volumes`

/**
 * How long the two supplementary catalogues get, together, for one book.
 *
 * Separate from the eight seconds the primary pair gets, and much shorter: the
 * primary pair decides whether there is a book at all, while the supplement only
 * decides how wide a spine is drawn and which of two shelves a book files on. It
 * bounds the whole round, both catalogues and any wait for a rate-limit slot.
 */
const SUPPLEMENT_TIMEOUT_MS = 3000

/**
 * Where an answer came from, when more than one catalogue could have given it:
 * which catalogue supplied a page count, which of them was checked and turned out
 * to be a different book, and which disagreed about a number. The coarse record
 * is still `source`, which becomes `books.lookup_source`, and
 * `classification.confidence`.
 *
 * Present only when the supplementary catalogues were consulted, which is only
 * when the primary pair left a gap, so its absence means "there was nothing to
 * reconcile" rather than "nobody recorded it".
 */
export interface LookupProvenance {
  /** The catalogue the page count came from, when a supplementary one supplied it. */
  pages: string
  /** Verified catalogues that stated a different page count, in rank order. */
  pagesDisagreedWith: string[]
  /** The catalogues whose headings decided the genre, in rank order. */
  genre: string[]
  /** Supplementary records confirmed by title to be this book. */
  verified: string[]
  /** Supplementary records that were a different book. Nothing was taken from them. */
  rejected: string[]
}

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
   * The headings the catalogues actually sent, kept rather than consumed, so a
   * caller can turn them into tags and not only read the fiction verdict they
   * were reduced to. Optional because a result assembled before they existed is
   * still a result: the two are read as "nothing was said", never as "nothing was
   * found".
   */
  subjects?: string[]
  categories?: string[]
  /** Which catalogue answered what, when more than one could have. */
  provenance?: LookupProvenance
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

/** One request to one of the two JSON catalogues, bounded. See `bounded-fetch.ts`. */
function getJson(
  url: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<Answer> {
  return fetchBounded(url, params, timeoutMs, 'json')
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
 * The bare-number form ("Discworld 5") is deliberately not matched. Requiring an
 * explicit separator costs a few missing indexes and avoids mangling a series
 * whose name genuinely ends in a number.
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
  const data = answer.data as Record<string, OpenLibraryData> | null

  // Noted after the parse rather than before it, because whether the reply held
  // this book is the one thing `bounded-fetch.ts` cannot see. A book Open Library
  // has no record of must not read as an outage.
  const entry = data?.[key]
  noteSourceAnswer('Open Library', outcomeOf(answer.answered, Boolean(entry?.title)), answer.why)
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
 * Deliberately not counted in the source report. It is a second request to a
 * catalogue this lookup has already recorded an answer from, and counting it
 * would double Open Library's `asked` against Google Books' one. A source that is
 * down fails the primary request too, and that one is counted.
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
  const data = answer.data as { items?: GoogleVolume[] } | null
  const first = data?.items?.[0]
  // `held` is the number that says whether a key changed anything: an unkeyed
  // request is refused and counted as `declined`, and a keyed one that answers
  // with nothing is a book Google Books does not have.
  noteSourceAnswer('Google Books', outcomeOf(answer.answered, Boolean(first)), answer.why)
  return first ? fromGoogleVolume(first) : null
}

export interface LookupOptions {
  timeoutMs?: number
  googleApiKey?: string
  /** The edition fetch is a second request per book, so it is opt-out. */
  fetchEdition?: boolean
  /**
   * Whether the two supplementary catalogues may be consulted. On by default, and
   * turned off by a caller that cannot use what they would say: `settleAmbiguity`
   * asks only whether an ISBN names a real book, and the cover backfill asks only
   * for a cover URL, so neither may spend somebody else's rate limit.
   */
  supplement?: boolean
}

/**
 * The genre a set of supplementary headings states, worded so it names who
 * stated it.
 *
 * `classify` is the arbiter and its ladder is not repeated here. Only the
 * sentence is rewritten, because `classify` writes "Open Library subjects (...)"
 * for anything handed to it as subjects, and that sentence is shown under the
 * toggle in the review pane, where a book classified off a Library of Congress
 * heading would otherwise name the wrong catalogue.
 */
function supplementaryClassification(taken: Reconciliation): Classification | null {
  const verdict = classify({
    subjects: [...taken.subjects],
    deweyDecimal: [...taken.dewey],
    lcClassifications: [...taken.lc],
  })
  if (!verdict.genre) return null

  const said = [...taken.subjects, ...taken.dewey, ...taken.lc].slice(0, 3).join(', ')
  return {
    genre: verdict.genre,
    confidence: verdict.confidence,
    reason:
      `${taken.headingsFrom.join(' and ')} states ` +
      `${verdict.genre === NON_FICTION_SLUG ? 'non-fiction' : 'fiction'}` +
      `${said ? ` (${said})` : ''}`,
  }
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
   * Both catalogues, and each of them has already told `source-watch.ts` what it
   * did by the time this line finishes. Nothing below reads that: a source going
   * quiet must not change the answer, must not add a note in front of somebody
   * holding a book, and must not stop the other source from being the answer.
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

  const title = openLibrary?.title || google?.title || ''
  let pages = openLibrary?.pages || google?.pages || ''
  let classification = classify({
    categories: google?.categories,
    subjects: openLibrary?.subjects,
    deweyDecimal: edition?.dewey,
    lcClassifications: edition?.lc,
  })
  let subjects = openLibrary?.subjects ?? []
  let provenance: LookupProvenance | undefined

  /*
   * `!pages || !classification.genre` is the gap, and it is the whole of why the
   * top-up is not a cost on every scan.
   *
   * `title` has to be non-empty because a record is believed only where its own
   * title agrees with ours, so with no title of ours nothing could be taken from
   * an answer even if one arrived.
   *
   * And all of it is reached only after the primary pair found the book. The
   * supplement can never introduce a book, only add to one: it does not decide
   * that an ISBN is real, it does not supply a title, and a lookup that would
   * have found nothing still finds nothing.
   */
  const wantsSupplement =
    options.supplement !== false && Boolean(title) && (!pages || !classification.genre)

  if (wantsSupplement) {
    const records = await askSupplementaryCatalogues(isbn, SUPPLEMENT_TIMEOUT_MS)
    const taken = reconcile(
      { title, pages, genreStated: Boolean(classification.genre) },
      records,
    )

    if (taken.pages) pages = taken.pages

    if (taken.headingsFrom.length) {
      const verdict = supplementaryClassification(taken)
      if (verdict) classification = verdict
      /*
       * In front of what Open Library sent, not behind it. `claimsFrom` keeps
       * the first `SUBJECT_LIMIT` headings, and these came from a controlled
       * vocabulary and were checked against our title before being believed, so
       * losing them to a slice of a list of free text would be losing the gain.
       */
      subjects = [...taken.subjects, ...subjects]
    }

    provenance = {
      pages: taken.pagesFrom,
      pagesDisagreedWith: taken.pagesDisagreedWith,
      genre: taken.headingsFrom,
      verified: taken.verified,
      rejected: taken.rejected,
    }

    // In rank order, and only the ones whose answer was kept. A catalogue that
    // replied, matched our title and had nothing to add does not belong in
    // `lookup_source`.
    for (const name of taken.verified) {
      if (name === taken.pagesFrom || taken.headingsFrom.includes(name)) sources.push(name)
    }
  }

  // After the top-up rather than before it, because the top-up can settle the
  // genre this sentence would otherwise ask a person for.
  if (classification.confidence === 'unknown') {
    notes.push('Fiction or non-fiction could not be determined. Please set it.')
  }

  return {
    found: true,
    title,
    subtitle: openLibrary?.subtitle || google?.subtitle || '',
    /*
     * The primary pair and nothing else, deliberately and permanently. A name
     * from a national catalogue is as often a variant spelling that would credit
     * two people where the collection has one, a translator, or the wrong person
     * entirely, so `catalogue-sru.ts` does not read MARC 100 or 700 at all.
     */
    authors: (openLibrary?.authors?.length ? openLibrary.authors : google?.authors) ?? [],
    publisher: openLibrary?.publisher || google?.publisher || '',
    published: openLibrary?.published || google?.published || '',
    pages,
    isbn13: openLibrary?.isbn13 || google?.isbn13 || '',
    isbn10: openLibrary?.isbn10 || google?.isbn10 || '',
    seriesName: edition?.seriesName ?? '',
    seriesIndex: edition?.seriesIndex ?? null,
    coverUrl: openLibrary?.coverUrl || google?.coverUrl || '',
    source: sources.join(' + '),
    classification,
    notes,
    subjects,
    categories: google?.categories ?? [],
    ...(provenance ? { provenance } : {}),
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
  const data = answer.data as { docs?: OpenLibraryDoc[] } | null

  // The one catalogue this route asks, counted the same way, so an empty search
  // because Open Library was down is not filed as a collection with no such book
  // in it, and an empty search because nobody has written that title down is not
  // filed as an outage.
  const doc = data?.docs?.[0]
  noteSourceAnswer('Open Library', outcomeOf(answer.answered, Boolean(doc?.title)), answer.why)
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
