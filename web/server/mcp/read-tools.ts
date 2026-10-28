/**
 * The tools that read the catalogue. Each maps its arguments onto one or two
 * query handlers from `web/application` and shapes what comes back for a
 * model to read: snake_case keys, nothing internal, and never a URL that only
 * a browser holding this app's cookie could fetch. The conventions are written
 * down in docs/the-mcp-connector.md, under "The tool surface".
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { BookView } from '../../application/books/read-models'
import type { CountBooksHandler } from '../../application/books/queries/count-books'
import type { GetBookHandler } from '../../application/books/queries/get-book'
import type { ListBooksHandler } from '../../application/books/queries/list-books'
import type { TagsOfBookHandler } from '../../application/tagging/queries/tags-of-book'
import type { VocabularyHandler } from '../../application/tagging/queries/vocabulary'
import type { ListAuthorsHandler } from '../../application/authorship/queries/list-authors'
import type { BooksByAuthorHandler } from '../../application/authorship/queries/books-by-author'
import type { AuthorView } from '../../application/authorship/read-models'
import type { LookupIsbnHandler } from '../../application/lookup/queries/lookup-isbn'
import type { ListQueueHandler } from '../../application/capture/queries/list-queue'
import type { CountQueueHandler } from '../../application/capture/queries/count-queue'
import type { CaptureStatus, QueueCounts, QueuedBookView } from '../../application/capture/read-models'
import { FAILURE_LABEL, failureOf } from '../../shared/captureFailure'
import { editsOn } from '../queue'
import { BOOK_STATES, CATALOGUED_STATES } from '../../domain/books/state'
import { TagSlug } from '../../domain/tagging/tags'
import { resolveIsbnPair } from '../../shared/isbn'
import { actingFor, answer, refuse } from './answers'

/** The handlers the read tools call, built once by `createApp`. */
export interface CatalogueQueries {
  listBooks: ListBooksHandler
  countBooks: CountBooksHandler
  getBook: GetBookHandler
  tagsOfBook: TagsOfBookHandler
  vocabulary: VocabularyHandler
  listAuthors: ListAuthorsHandler
  booksByAuthor: BooksByAuthorHandler
  lookupIsbn: LookupIsbnHandler
  listQueue: ListQueueHandler
  countQueue: CountQueueHandler
}

/**
 * A page a model asks for. Smaller than the `/api` listing's cap because every
 * row is read into a context window, and Claude Code truncates a tool answer
 * past about 25,000 tokens.
 */
const DEFAULT_PAGE = 25
const LARGEST_PAGE = 100

const READ = { readOnlyHint: true, openWorldHint: false } as const

const pageInput = {
  limit: z.number().int().min(1).max(LARGEST_PAGE).optional()
    .describe(`How many to return, 1 to ${LARGEST_PAGE}. Defaults to ${DEFAULT_PAGE}.`),
  offset: z.number().int().min(0).optional()
    .describe('How many to skip, for the next page. Pass the previous answer\'s next_offset.'),
}

const pageOutput = {
  total: z.number().int().describe('How many matched, across every page.'),
  offset: z.number().int(),
  limit: z.number().int(),
  next_offset: z.number().int().nullable()
    .describe('The offset of the next page, or null when this page is the last.'),
}

function paged(total: number, offset: number, limit: number, returned: number) {
  return { total, offset, limit, next_offset: offset + returned < total ? offset + returned : null }
}

const bookSummary = z.object({
  book_id: z.number().int(),
  title: z.string(),
  subtitle: z.string(),
  authors: z.string().describe('The names as printed on the book.'),
  isbn13: z.string(),
  published: z.string(),
  range: z.string()
    .describe('"fiction" or "nonfiction", the run of bookcases it files into; empty when no genre tag decides it.'),
  state: z.enum(BOOK_STATES),
  location: z.string()
    .describe('Where it stands, as the shelves label it (a bookcase and plank such as "1A"); empty when nobody has placed it.'),
  series_name: z.string(),
  series_index: z.number().nullable(),
})

type BookSummary = z.infer<typeof bookSummary>

function summaryOf(book: BookView): BookSummary {
  return {
    book_id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors,
    isbn13: book.isbn13,
    published: book.published,
    range: book.shelf_range,
    state: book.state,
    location: book.location,
    series_name: book.series_name,
    series_index: book.series_index,
  }
}

const PHOTOGRAPH_KINDS = ['front', 'back', 'edge', 'cover'] as const

export const tagEntry = z.object({
  slug: z.string(),
  label: z.string(),
  source: z.enum(['person', 'catalogue', 'guess'])
    .describe('"person" is somebody saying so; "catalogue" and "guess" are this app inferring it.'),
  confidence: z.enum(['high', 'medium', 'weak', 'unknown']),
})

export const bookDetail = bookSummary.extend({
  isbn10: z.string(),
  publisher: z.string(),
  pages: z.string(),
  notes: z.string(),
  title_guess: z.string()
    .describe('What the camera read off a book nobody has identified yet; empty once it has a title.'),
  scanned_at: z.string(),
  checked_out_at: z.string().nullable().describe('When it left the shelf, while it is out.'),
  lookup_source: z.string().describe('The catalogues its record came from.'),
  photographs: z.array(z.enum(PHOTOGRAPH_KINDS))
    .describe('Which photographs are on record. The images themselves are only shown in the app.'),
  credits: z.array(z.object({
    position: z.number().int().describe('1 is the first name printed.'),
    author_id: z.number().int().describe('For get_author_books.'),
    name: z.string(),
    files_under: z.string().describe('The name the shelves sort this credit by.'),
  })),
  tags: z.array(tagEntry),
})

export type BookDetail = z.infer<typeof bookDetail>
type TagEntry = z.infer<typeof tagEntry>

/** The tags a book carries, as every tool answers them. Null when there is no such book. */
export async function tagsOf(queries: CatalogueQueries, bookId: number): Promise<TagEntry[] | null> {
  const tags = await queries.tagsOfBook.handle({ bookId })
  return tags && tags.map((one) => ({
    slug: one.slug, label: one.label, source: one.source, confidence: one.confidence,
  }))
}

/** One book as `get_book` answers it, and as a write tool answers the book it wrote. */
export async function describeBook(queries: CatalogueQueries, bookId: number): Promise<BookDetail | null> {
  const found = await queries.getBook.handle({ id: bookId })
  const tags = found && await tagsOf(queries, bookId)
  if (!found || !tags) return null
  const { book } = found
  return {
    ...summaryOf(book),
    isbn10: book.isbn10,
    publisher: book.publisher,
    pages: book.pages,
    notes: book.notes,
    title_guess: book.title_guess,
    scanned_at: book.scanned_at,
    checked_out_at: book.checked_out_at,
    lookup_source: book.lookup_source,
    photographs: PHOTOGRAPH_KINDS.filter((kind) => book[`${kind}_image`] !== ''),
    credits: found.authors.map((credit) => ({
      position: credit.position,
      author_id: credit.authorId,
      name: credit.displayName,
      files_under: credit.filingName,
    })),
    tags,
  }
}

const authorEntry = z.object({
  author_id: z.number().int(),
  name: z.string().describe('The primary name.'),
  is_corporate: z.boolean(),
  names: z.array(z.object({
    name: z.string(),
    files_under: z.string(),
    primary: z.boolean(),
  })).describe('Every name this person publishes under.'),
})

function authorOf(author: AuthorView): z.infer<typeof authorEntry> {
  return {
    author_id: author.id,
    name: author.primary,
    is_corporate: author.isCorporate,
    names: author.aliases.map((alias) => ({
      name: alias.displayName,
      files_under: alias.filingName,
      primary: alias.isPrimary,
    })),
  }
}

/**
 * The queue's statuses in the first screen's words. `done` is not here: a book
 * that is done has left the queue, and the queue never lists one.
 */
const QUEUE_WORD = {
  pending: 'being_read',
  ready: 'ready_to_shelve',
  failed: 'stuck',
} as const satisfies Record<Exclude<CaptureStatus, 'done'>, string>

type QueueWord = (typeof QUEUE_WORD)[keyof typeof QUEUE_WORD]
const QUEUE_WORDS = Object.values(QUEUE_WORD) as [QueueWord, ...QueueWord[]]

/**
 * Finishing a queued book is a person holding it. Said by both tools that show
 * the queue, so a model that has seen either tells the person rather than
 * reaching for add_book, which would catalogue a second copy beside the queued one.
 */
export const FINISHED_IN_THE_APP =
  'A queued book is confirmed and shelved only in the book-scan app, by a person with the book in ' +
  'hand checking the photographs and the record; no tool here does it. Do not call add_book with a ' +
  'queued book\'s ISBN: that catalogues a second copy and leaves the queued one where it is. Tell the ' +
  'person to finish it from the queue in the app instead.'

const queueCounts = {
  ready_to_shelve: z.number().int()
    .describe('In the scanning queue, identified, waiting for a person to confirm and shelve it. Not catalogued yet.'),
  stuck: z.number().int()
    .describe('In the scanning queue, and its photographs did not lead to a record. Not catalogued yet.'),
  being_read: z.number().int()
    .describe('In the scanning queue, photographs not read yet. Not catalogued yet.'),
}

function queueCountsOf(counts: QueueCounts): { [K in keyof typeof queueCounts]: number } {
  return { ready_to_shelve: counts.ready, stuck: counts.failed, being_read: counts.pending }
}

const queuedBook = z.object({
  book_id: z.number().int().describe('For get_book.'),
  status: z.enum(QUEUE_WORDS),
  title: z.string()
    .describe('The title a catalogue found or a person typed in; empty when neither has said.'),
  title_guess: z.string()
    .describe('What the camera read off the cover. A machine\'s guess, never a confirmed title.'),
  authors: z.string().describe('The names a catalogue found or a person typed in, joined with ", ".'),
  isbn13: z.string().describe('The ISBN read off the book or typed in; empty when there is none yet.'),
  stuck_because: z.string().nullable()
    .describe('For a stuck book, what it needs, in the app\'s words; null otherwise.'),
  scanned_at: z.string().describe('When the first photograph arrived.'),
  photographs: z.array(z.enum(PHOTOGRAPH_KINDS))
    .describe('Which photographs are on record. The images themselves are only shown in the app.'),
})

/** What the worker's lookup found, or null. Only the fields a queued book's name is made of. */
function lookedUp(book: QueuedBookView): { title: string; authors: string[] } | null {
  try {
    const found = JSON.parse(book.draft_json || 'null') as
      { found?: boolean; title?: string; authors?: string[] } | null
    return found?.found ? { title: found.title ?? '', authors: found.authors ?? [] } : null
  } catch {
    return null
  }
}

/**
 * A queued book as `list_queue` answers it. What a person typed outranks what
 * a catalogue found, field by field, which is the rule the queue screen draws
 * by. Who holds the book and since when are left out on purpose: a claim is
 * somebody at a phone mid-task, and nothing a model could do with it helps them.
 */
function queuedOf(book: QueuedBookView & { status: Exclude<CaptureStatus, 'done'> }): z.infer<typeof queuedBook> {
  const stated = editsOn(book)
  const found = lookedUp(book)
  return {
    book_id: book.id,
    status: QUEUE_WORD[book.status],
    title: (stated.title ?? found?.title ?? '').trim(),
    title_guess: book.title_guess.trim(),
    authors: (stated.authors ?? found?.authors ?? []).join(', '),
    isbn13: stated.isbn13 ?? book.isbn13,
    stuck_because: book.status === 'failed' ? FAILURE_LABEL[failureOf(book)] : null,
    scanned_at: book.created_at,
    photographs: PHOTOGRAPH_KINDS.filter((kind) => book[`${kind}_image`] !== ''),
  }
}

/** The queue lists `queued_books` only, so a `done` row here would be a defect upstream. */
function isQueued(book: QueuedBookView): book is QueuedBookView & { status: Exclude<CaptureStatus, 'done'> } {
  return book.status !== 'done'
}

export function registerReadTools(server: McpServer, queries: CatalogueQueries): void {
  server.registerTool('search_books', {
    title: 'Search books',
    description:
      'Searches the catalogued books (shelved, checked out or withdrawn) and answers one page of short ' +
      'records, fiction then non-fiction, each in shelf order. Every filter is optional and they combine: ' +
      'with none, it pages through the whole collection. Books still waiting in the scanning queue are ' +
      'not catalogued and are not searched; list_queue lists them. Call get_book with a book_id for tags, credits and the rest; ' +
      'list_tags for the tag slugs; list_authors for an author_id.',
    inputSchema: {
      words: z.string().max(200).optional()
        .describe('Words from the title or an author\'s name, any order, accents optional ("mieville city").'),
      isbn: z.string().max(20).optional().describe('An ISBN-10 or ISBN-13; either finds the book.'),
      tags: z.array(z.string().max(200)).max(10).optional()
        .describe('Tag slugs such as "genre/fantasy". A book must carry every one, itself or one under it.'),
      range: z.enum(['fiction', 'nonfiction']).optional()
        .describe('Only one run of bookcases. Omit for both.'),
      author_id: z.number().int().positive().optional()
        .describe('Only books crediting this person under any of their names. From list_authors.'),
      state: z.enum(CATALOGUED_STATES).optional()
        .describe('"shelved" is on the shelves, "checked_out" is lent or away, "withdrawn" is gone from the collection.'),
      placed: z.boolean().optional()
        .describe('true: standing on a known plank. false: shelved but nobody has said where.'),
      ...pageInput,
    },
    outputSchema: { ...pageOutput, books: z.array(bookSummary) },
    annotations: READ,
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const tags: TagSlug[] = []
    for (const raw of args.tags ?? []) {
      const slug = TagSlug.parse(raw)
      if (!slug) return refuse(`"${raw}" is not a tag slug. list_tags shows the ones this catalogue uses.`)
      tags.push(slug)
    }
    const limit = args.limit ?? DEFAULT_PAGE
    const offset = args.offset ?? 0
    const found = await queries.listBooks.handle({
      words: args.words,
      isbn: args.isbn,
      tags,
      range: args.range ?? null,
      authorId: args.author_id,
      state: args.state,
      placed: args.placed,
      limit,
      offset,
    })
    return answer({
      ...paged(found.total, offset, limit, found.books.length),
      books: found.books.map(summaryOf),
    })
  })

  server.registerTool('get_book', {
    title: 'Get a book',
    description:
      'One book by its book_id, in any state including one still in the scanning queue: its record, ' +
      'where it stands, its tags with who applied each, the authors it credits with their author_id, ' +
      'and which photographs exist. Find a book_id with search_books or get_author_books.',
    inputSchema: {
      book_id: z.number().int().positive().describe('From search_books or get_author_books.'),
    },
    outputSchema: bookDetail.shape,
    annotations: READ,
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const book = await describeBook(queries, args.book_id)
    if (!book) return refuse(`There is no book ${args.book_id}. search_books finds book ids.`)
    return answer(book)
  })

  server.registerTool('collection_summary', {
    title: 'Collection summary',
    description:
      'How many books the catalogue holds, how many are fiction and non-fiction, how many are checked ' +
      'out, and how many are shelved with no known place; and, apart from those, how many are still in ' +
      'the scanning queue with no shelf yet, in the words the app\'s first screen uses: ready to shelve, ' +
      'stuck, and being read. Queued books are not in total. Cheap; call it before paging through ' +
      'search_books or list_queue. ' + FINISHED_IN_THE_APP,
    outputSchema: {
      total: z.number().int().describe('Shelved, checked out and withdrawn together. Queued books are not counted.'),
      fiction: z.number().int(),
      nonfiction: z.number().int(),
      checked_out: z.number().int(),
      unplaced: z.number().int().describe('Shelved, and nobody has said which plank. search_books with placed false lists them.'),
      ...queueCounts,
    },
    annotations: READ,
  }, async (extra) => {
    actingFor(extra.authInfo)
    const counts = await queries.countBooks.handle()
    return answer({
      total: counts.total,
      fiction: counts.fiction,
      nonfiction: counts.nonfiction,
      checked_out: counts.checkedOut,
      unplaced: counts.unplaced,
      ...queueCountsOf(await queries.countQueue.handle()),
    })
  })

  server.registerTool('list_queue', {
    title: 'List the scanning queue',
    description:
      'The books in the scanning queue: photographed with the app\'s camera and not catalogued yet, so ' +
      'search_books does not find them and none has a shelf. Oldest scan first, one page at a time. ' +
      'status says which of the app\'s first-screen counts each is in: "ready_to_shelve" (identified, ' +
      'waiting for a person to confirm it), "stuck" (stuck_because says what it needs) or "being_read" ' +
      '(photographs not read yet). Reads only. ' + FINISHED_IN_THE_APP +
      ' get_book with a book_id shows one queued book in full.',
    inputSchema: {
      status: z.enum(QUEUE_WORDS).optional().describe('Only books with this status. Omit for the whole queue.'),
      ...pageInput,
    },
    outputSchema: { ...pageOutput, books: z.array(queuedBook) },
    annotations: READ,
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const limit = args.limit ?? DEFAULT_PAGE
    const offset = args.offset ?? 0
    const queued = (await queries.listQueue.handle()).filter(isQueued).map(queuedOf)
    const matching = args.status ? queued.filter((book) => book.status === args.status) : queued
    const page = matching.slice(offset, offset + limit)
    return answer({ ...paged(matching.length, offset, limit, page.length), books: page })
  })

  server.registerTool('list_tags', {
    title: 'List tags',
    description:
      'The tag vocabulary, in slug order, with how many catalogued books carry each (itself or anything ' +
      'under it). Slugs are paths: "genre/fantasy/epic" is under "genre/fantasy", which is under "genre". ' +
      'A genre tag decides which run of bookcases a book files into. Every tag, not a page: there are tens.',
    inputSchema: {
      under: z.string().max(200).optional().describe('Only this slug and the ones beneath it, such as "genre".'),
    },
    outputSchema: {
      tags: z.array(z.object({
        slug: z.string(),
        label: z.string(),
        note: z.string(),
        books: z.number().int(),
        ruled: z.boolean().describe('Whether a shelving rule files books by it.'),
      })),
    },
    annotations: READ,
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const under = args.under ? TagSlug.parse(args.under) : null
    if (args.under && !under) return refuse(`"${args.under}" is not a tag slug.`)
    const tags = await queries.vocabulary.handle({ under: under ?? undefined })
    return answer({ tags: tags.map(({ slug, label, note, books, ruled }) => ({ slug, label, note, books, ruled })) })
  })

  server.registerTool('list_authors', {
    title: 'List authors',
    description:
      'The people this collection credits, oldest first, each with every name they publish under and ' +
      'the name each files under. One person may write as several names; author_id is the person. ' +
      'Pass author_id to get_author_books, or to search_books to combine it with other filters.',
    inputSchema: {
      name: z.string().max(200).optional()
        .describe('Only people with a name containing this, ignoring case and accents.'),
      ...pageInput,
    },
    outputSchema: { ...pageOutput, authors: z.array(authorEntry) },
    annotations: READ,
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const limit = args.limit ?? DEFAULT_PAGE
    const offset = args.offset ?? 0
    const everyone = await queries.listAuthors.handle({ name: args.name })
    const page = everyone.slice(offset, offset + limit)
    return answer({ ...paged(everyone.length, offset, limit, page.length), authors: page.map(authorOf) })
  })

  server.registerTool('get_author_books', {
    title: 'Get an author\'s books',
    description:
      'One person and every book crediting any of their names, in any state (queued books included), ' +
      'oldest record first. Use search_books with author_id instead to narrow by tag, range or state.',
    inputSchema: {
      author_id: z.number().int().positive().describe('From list_authors or get_book\'s credits.'),
      ...pageInput,
    },
    outputSchema: { author: authorEntry, ...pageOutput, books: z.array(bookSummary) },
    annotations: READ,
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const found = await queries.booksByAuthor.handle({ authorId: args.author_id })
    if (!found) return refuse(`There is no author ${args.author_id}. list_authors finds author ids.`)
    const limit = args.limit ?? DEFAULT_PAGE
    const offset = args.offset ?? 0
    const page = found.books.slice(offset, offset + limit)
    return answer({
      author: authorOf(found.author),
      ...paged(found.books.length, offset, limit, page.length),
      books: page.map(summaryOf),
    })
  })

  server.registerTool('lookup_isbn', {
    title: 'Look up an ISBN',
    description:
      'Asks the national catalogues (Open Library, then Google Books) what they hold for an ISBN, and ' +
      'says whether this collection already has it. Writes nothing and adds no book. found false means ' +
      'neither catalogue knows the number; notes says what was tried.',
    inputSchema: {
      isbn: z.string().max(20).describe('An ISBN-10 or ISBN-13, hyphens and spaces allowed.'),
    },
    outputSchema: {
      found: z.boolean(),
      isbn13: z.string(),
      isbn10: z.string(),
      title: z.string(),
      subtitle: z.string(),
      authors: z.array(z.string()),
      publisher: z.string(),
      published: z.string(),
      pages: z.string(),
      series_name: z.string(),
      series_index: z.number().nullable(),
      genre: z.string().nullable()
        .describe('The genre tag the catalogues\' subject headings point at, or null when none stated one.'),
      genre_confidence: z.string(),
      genre_reason: z.string(),
      subjects: z.array(z.string()),
      source: z.string().describe('Which catalogues answered.'),
      cover_url: z.string().describe('The catalogue\'s own cover image, on its own host; empty when it has none.'),
      notes: z.array(z.string()),
      already_catalogued: z.object({
        book_id: z.number().int(),
        title: z.string(),
        location: z.string(),
      }).nullable().describe('The book in this collection with this number, or null.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const asked = resolveIsbnPair(args.isbn)
    if (!asked.isbn13) {
      return refuse(`"${args.isbn}" is not a valid ISBN-10 or ISBN-13. Check the digits and the check digit.`)
    }
    const { record, duplicateOf } = await queries.lookupIsbn.handle({ isbn: args.isbn })
    // A record nobody found carries `lookup.ts`'s default genre, which no catalogue stated.
    const classification = record.found
      ? record.classification
      : { genre: null, confidence: 'unknown', reason: 'Neither catalogue knows this number, so nothing states a genre.' }
    return answer({
      found: record.found,
      isbn13: record.isbn13 || asked.isbn13,
      isbn10: record.isbn10 || asked.isbn10,
      title: record.title,
      subtitle: record.subtitle,
      authors: record.authors,
      publisher: record.publisher,
      published: record.published,
      pages: record.pages,
      series_name: record.seriesName,
      series_index: record.seriesIndex,
      genre: classification.genre,
      genre_confidence: classification.confidence,
      genre_reason: classification.reason,
      subjects: [...(record.subjects ?? []), ...(record.categories ?? [])],
      source: record.source,
      cover_url: record.coverUrl,
      notes: record.notes,
      already_catalogued: duplicateOf
        ? { book_id: duplicateOf.id, title: duplicateOf.title, location: duplicateOf.location }
        : null,
    })
  })
}
