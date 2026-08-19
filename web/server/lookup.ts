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
 *
 * ## Since #305 there are four catalogues, and two of them are a top-up
 *
 * `docs/catalogue-sources.md` asked five candidates about all 238 books in the
 * real catalogue. Library of Congress and K10plus between them reach every one
 * of the 15 books nobody has classified and 33 of the 55 drawn at a guessed
 * spine width, both without a key, and 65 of 65 of their records were verified
 * as the right book. They are asked here, through `catalogue-sru.ts`, and what
 * may be taken from them is decided by
 * `domain/books/catalogue-reconciliation.ts`.
 *
 * **Three things about how they are asked, each of which is a rule from an
 * issue rather than a preference:**
 *
 * 1. **They are asked only about a book the first two left a gap in**, meaning
 *    no page count or no stated genre. On the measurement's numbers that is
 *    under a quarter of books, and for the rest a lookup costs exactly what it
 *    cost before: same requests, same deadline, same result. This is also what
 *    keeps the app inside two catalogues' rate limits, and `source-pace.ts`
 *    holds it there.
 * 2. **They are asked inside the same call, not deferred to a later pass.**
 *    #294 is the cautionary tale for the other design: work that sat behind
 *    other work became work that never happened. A page count that arrives after
 *    the book was shelved is a spine already drawn, and a second pass to redraw
 *    it is a second mechanism nobody would watch.
 * 3. **They cannot make a lookup wait longer than the bound on them.** Both are
 *    asked at once, under `SUPPLEMENT_TIMEOUT_MS`, and the round is skipped
 *    outright wherever there is nothing to gain. #299 bounded the one reader
 *    this app had for exactly this reason; a new source with no bound would put
 *    it straight back.
 */

import { classify, type Classification } from './classify'
import { noteSourceAnswer } from './source-watch'
import { askSupplementaryCatalogues } from './catalogue-sru'
import { fetchBounded, type Answer } from './bounded-fetch'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { reconcile, type Reconciliation } from '../domain/books/catalogue-reconciliation'
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

/**
 * How long the two supplementary catalogues get, together, for one book.
 *
 * Separate from the eight seconds the primary pair gets, and much shorter, for
 * a reason that is about who is waiting rather than about how fast a library
 * is. The primary pair decides whether there is a book at all: without it there
 * is nothing to show, so it is worth waiting for. The supplement decides how
 * wide a spine is drawn and which of two shelves a book files on, and the
 * alternative to waiting is a median width and a book somebody classifies by
 * hand later. Three seconds is what that is worth.
 *
 * It bounds the whole round, both catalogues and any wait for a rate-limit slot,
 * so this number is the most a lookup can be made slower by #305.
 */
const SUPPLEMENT_TIMEOUT_MS = 3000

/**
 * Where an answer came from, when more than one catalogue could have given it.
 *
 * #305 asked for this and asked for it to extend what exists rather than to
 * invent a parallel notion of provenance, so the coarse record is still `source`
 * (which becomes `books.lookup_source` and now reads, for a topped-up book,
 * `Open Library + Library of Congress`) and `classification.confidence`, which
 * already says how strongly a genre was stated. This is the detail underneath
 * those two: which catalogue supplied a page count, which of them was checked
 * and turned out to be a different book, and which disagreed about a number.
 *
 * Present only when the supplementary catalogues were consulted, which is only
 * when the primary pair left a gap, so its absence means "there was nothing to
 * reconcile" rather than "nobody recorded it". It rides along in `draft_json` on
 * a queued book like the rest of the lookup, so what a decision was made on
 * survives the browser being closed.
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
  /** Which catalogue answered what, when more than one could have (#305). */
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

/**
 * One request to one of the two JSON catalogues, bounded.
 *
 * The abort, the three outcomes and the closed vocabulary on `why` moved to
 * `bounded-fetch.ts` when #305 added two catalogues that needed the same thing
 * and answer XML rather than JSON. Nothing about the behaviour changed and the
 * reasoning is all still written down, in that file's header and on `Answer`.
 */
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
  /**
   * Whether the two supplementary catalogues may be consulted (#305).
   *
   * On by default, and turned off by a caller that cannot use what they would
   * say. Two of those exist and both are in `server/index.ts`: `settleAmbiguity`
   * asks only whether an ISBN names a real book, and the cover backfill asks
   * only for a cover URL. Neither can use a page count or a subject heading, and
   * spending somebody else's rate limit to fetch one for the bin is exactly what
   * the limit is there to prevent.
   */
  supplement?: boolean
}

/**
 * The genre a set of supplementary headings states, worded so it names who
 * stated it.
 *
 * `classify` is the arbiter and its ladder is not repeated here: what it decides
 * and how confidently it decided are taken as they come, which is what
 * `docs/catalogue-sources.md` asked for when it said not to write a second
 * opinion about what counts as a stated genre. Only the sentence is rewritten,
 * because `classify` writes "Open Library subjects (...)" for anything handed to
 * it as subjects, and that sentence is shown under the toggle in the review
 * pane. A book classified off a Library of Congress heading that told the person
 * it came from Open Library would put the provenance wrong in the one place
 * somebody actually reads it.
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
   * ------------------------------------------------------------------------
   * The top-up (#305), and the three conditions on it.
   * ------------------------------------------------------------------------
   *
   * `!pages || !classification.genre` is the gap, and it is the whole of why
   * this is not a cost on every scan. `docs/catalogue-sources.md` measured 55
   * books of 238 without a page count and 19 without a stated genre, so on the
   * real collection this branch is not taken for roughly four books in five,
   * and for those four a lookup makes exactly the requests it made before #305
   * and finishes exactly as fast.
   *
   * `title` has to be non-empty because a record is believed only where its own
   * title agrees with ours, so with no title of ours nothing could be taken from
   * an answer even if one arrived, and asking would spend a stranger's rate
   * limit on something that has to be thrown away.
   *
   * And all of it is reached only after the primary pair found the book. **The
   * supplement can never introduce a book, only add to one**: it does not decide
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
       * the first `SUBJECT_LIMIT` headings, because a book carrying two hundred
       * tags is a book with no tags and Open Library returns everything anybody
       * ever attached to an edition. These headings are from a controlled
       * vocabulary, were checked against our title before being believed, and
       * are the thing this book was short of; losing them to a slice of a list
       * of free text would be losing the gain.
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
    // replied, matched our title and had nothing to add is not a source of
    // anything on this book and does not belong in `lookup_source`.
    for (const name of taken.verified) {
      if (name === taken.pagesFrom || taken.headingsFrom.includes(name)) sources.push(name)
    }
  }

  // After the top-up rather than before it. This sentence asks a person to do a
  // job, and the point of the two extra catalogues is that fifteen of the books
  // it was being shown for now have an answer without one.
  if (classification.confidence === 'unknown') {
    notes.push('Fiction or non-fiction could not be determined. Please set it.')
  }

  return {
    found: true,
    title,
    subtitle: openLibrary?.subtitle || google?.subtitle || '',
    /*
     * The primary pair and nothing else, deliberately and permanently.
     *
     * `catalogue-sru.ts` does not read MARC 100 or 700, so there is no name from
     * a national catalogue anywhere in this process to put here even by mistake.
     * Of the 34 apparent author gains `docs/catalogue-sources.md` read one at a
     * time, 33 were a variant spelling that would credit two people where the
     * collection has one, a translator or an illustrator, or the wrong person
     * entirely.
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
