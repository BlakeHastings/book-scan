/**
 * The tools that change the catalogue: add a book by its ISBN, edit one, and put
 * one under a tag or take it out of one. Each calls the same command handler the
 * app's own save and tag routes call, so a book Claude adds is filed, credited
 * and placed by the one save path there is. There is no delete tool.
 *
 * The commands take no person. Nothing a save or a tag writes records who did
 * it beyond `source = 'person'` on a tag and `actor = 'person'` on a placement,
 * so a tool acting for somebody writes exactly what they would have written from
 * the app.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { CatalogueBookHandler } from '../../application/books/commands/catalogue-book'
import type { ReviseBookHandler } from '../../application/books/commands/revise-book'
import type { ApplyTagHandler } from '../../application/tagging/commands/apply-tag'
import type { RemoveTagHandler } from '../../application/tagging/commands/remove-tag'
import { namesADifferentBook, type BookDescription } from '../../domain/books/book'
import { CATALOGUED_STATES } from '../../domain/books/state'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { GenreSlug } from '../../domain/tagging/genre'
import { TagSlug } from '../../domain/tagging/tags'
import { resolveIsbnPair } from '../../shared/isbn'
import type { Neighbour, Placement } from '../../shared/shelving'
import { catalogueCommandOf, draftFromRecord } from '../book-commands'
import type { DraftBook } from '../store'
import { actingFor, answer, refuse } from './answers'
import { bookDetail, describeBook, tagEntry, tagsOf, type CatalogueQueries } from './read-tools'

/** The book commands the write tools call, built once by `createApp`. */
export interface CatalogueCommands {
  catalogueBook: CatalogueBookHandler
  reviseBook: ReviseBookHandler
  applyTag: ApplyTagHandler
  removeTag: RemoveTagHandler
}

const GENRES: Record<'fiction' | 'nonfiction', GenreSlug> = {
  fiction: FICTION_SLUG,
  nonfiction: NON_FICTION_SLUG,
}

const genreInput = z.enum(['fiction', 'nonfiction'])

const neighbour = z.object({
  book_id: z.number().int(),
  title: z.string(),
  files_under: z.string(),
}).nullable()

const goesBetween = z.object({
  after: neighbour.describe('The book it stands immediately after, or null at the start of the run.'),
  before: neighbour.describe('The book it stands immediately before, or null at the end of the run.'),
}).nullable()
  .describe('Its two neighbours in shelf order; null when no genre tag files it into either run.')

function neighbourOf(one: Neighbour | null): z.infer<typeof neighbour> {
  return one && { book_id: one.id, title: one.title, files_under: one.authorFiling }
}

function between(placement: Placement | null): z.infer<typeof goesBetween> {
  return placement && { after: neighbourOf(placement.predecessor), before: neighbourOf(placement.successor) }
}

const now = () => new Date().toISOString()

const NOT_AN_ISBN = (isbn: string) =>
  `"${isbn}" is not a valid ISBN-10 or ISBN-13. Check the digits and the check digit.`

export function registerWriteTools(
  server: McpServer,
  queries: CatalogueQueries,
  commands: CatalogueCommands,
): void {
  server.registerTool('add_book', {
    title: 'Add a book',
    description:
      'Adds a book to the catalogue by its ISBN, the way scanning it in the app does: looks the number up ' +
      'in Open Library and Google Books, saves the record they hold, files it by its first author and title, ' +
      'and records it as standing in the gap where it lands on the shelf. Answers the book as get_book does ' +
      'and the two books it now stands between. If this collection already has a book with that ISBN, ' +
      'nothing is added and the existing book is answered with added false, so asking again for a book ' +
      'that was added answers it rather than adding a copy. If neither catalogue knows the number, nothing is added ' +
      'unless you pass title (and authors) as the person read them off the book; never fill them in from ' +
      'memory. Pass genre only when the person has said which; it is then their answer and outranks the ' +
      'catalogues\' guess. lookup_isbn previews the record without adding anything.',
    inputSchema: {
      isbn: z.string().max(20).describe('An ISBN-10 or ISBN-13, hyphens and spaces allowed.'),
      genre: genreInput.optional()
        .describe('Which run of bookcases it files into, as the person said. Omit to take the catalogues\' guess, which may be none.'),
      files_under: z.string().max(200).optional()
        .describe('What the first-listed author files under, such as "Le Guin, Ursula K.", when the person corrects it. Omit to use the name as this collection already files it.'),
      notes: z.string().max(2000).optional().describe('A note about this copy, such as "signed".'),
      title: z.string().max(500).optional()
        .describe('Used only when neither catalogue knows the ISBN: the title as printed, from the person.'),
      authors: z.array(z.string().max(200)).max(20).optional()
        .describe('Used only with title: the names as printed, in printed order.'),
    },
    outputSchema: {
      added: z.boolean().describe('false when the collection already had this ISBN and nothing was written.'),
      record_from: z.enum(['catalogue', 'person', 'existing'])
        .describe('Where the record came from: the outside catalogues, the title you passed, or the book already here.'),
      book: bookDetail,
      goes_between: goesBetween,
      notes: z.array(z.string()).describe('What the lookup said about the number.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const pair = resolveIsbnPair(args.isbn)
    if (!pair.isbn13) return refuse(NOT_AN_ISBN(args.isbn))

    const { record, duplicateOf } = await queries.lookupIsbn.handle({ isbn: args.isbn })
    const existing = async (id: number) => {
      const book = await describeBook(queries, id)
      if (!book) throw new Error(`book ${id} was found by its ISBN and cannot be read back`)
      return answer({ added: false, record_from: 'existing', book, goes_between: null, notes: record.notes })
    }
    // Answered here without a lock, since a book already catalogued stays so; a
    // book catalogued after this read is found again by the handler, under the
    // number's lock (#637).
    if (duplicateOf) return existing(duplicateOf.id)

    const given = args.title?.trim()
    let draft: DraftBook
    if (record.found) {
      draft = draftFromRecord(record, 'manual')
      draft.isbn13 ||= pair.isbn13
      draft.isbn10 ||= pair.isbn10
    } else if (given) {
      draft = {
        isbn13: pair.isbn13,
        isbn10: pair.isbn10,
        title: given,
        authors: args.authors ?? [],
        genre: null,
        isbnSource: 'manual',
      }
    } else {
      return refuse(
        `Neither Open Library nor Google Books knows ${args.isbn} (${record.notes.join(' ') || 'no record'}). ` +
        'Nothing was added. Ask the person for the title and the authors as printed on the book, ' +
        'then call add_book again with title and authors.',
      )
    }

    if (args.genre) {
      draft.genre = GENRES[args.genre]
      draft.classificationSource = 'manual'
      draft.classificationConfidence = 'high'
    }
    if (args.notes !== undefined) draft.notes = args.notes
    if (args.files_under?.trim()) draft.authorFilingOverride = args.files_under.trim()

    const saved = await commands.catalogueBook.handle(catalogueCommandOf(draft, now(), 'answer-it'))
    if (!saved.added) return existing(saved.id)
    const { id, placement } = saved
    const book = await describeBook(queries, id)
    if (!book) throw new Error(`book ${id} was catalogued and cannot be read back`)
    return answer({
      added: true,
      record_from: record.found ? 'catalogue' : 'person',
      book,
      goes_between: between(placement),
      notes: record.notes,
    })
  })

  server.registerTool('update_book', {
    title: 'Update a book',
    description:
      'Changes the fields you pass on one catalogued book and leaves every other field as it is. Answers ' +
      'the book as get_book does, and the two books it now stands between. Changing the ISBN says this row ' +
      'is a different book: every genre and subject tag on it is withdrawn, including ones a person ' +
      'applied, and the answer says reidentified true and lists them. Pass genre in the same call to file ' +
      'the corrected book, or it is left in neither run. Other tags (such as "mine/signed") stay. ' +
      'genre is recorded as the person\'s answer and outranks any guess. A book still in the scanning ' +
      'queue is refused; it is saved from the app. Moving a book to another plank is not done here. ' +
      'Find the book_id with search_books.',
    inputSchema: {
      book_id: z.number().int().positive().describe('From search_books or get_book.'),
      isbn: z.string().max(20).optional()
        .describe('A corrected ISBN-10 or ISBN-13. Withdraws every genre and subject tag; see above.'),
      title: z.string().max(500).optional(),
      subtitle: z.string().max(500).optional(),
      authors: z.array(z.string().max(200)).max(20).optional()
        .describe('Every name as printed, in printed order. Replaces the whole list.'),
      publisher: z.string().max(500).optional(),
      published: z.string().max(50).optional().describe('As the book gives it, usually a year.'),
      pages: z.string().max(20).optional(),
      notes: z.string().max(2000).optional().describe('Replaces the whole note; "" clears it.'),
      series_name: z.string().max(500).optional().describe('"" takes it out of a series.'),
      series_index: z.number().min(0).nullable().optional().describe('Its number in the series; null for none.'),
      genre: genreInput.optional()
        .describe('Which run of bookcases it files into. Moves the book when it changes the run.'),
      files_under: z.string().max(200).optional()
        .describe('What the first-listed author files under, such as "Le Guin, Ursula K.". Re-files every book under that name the next time each is saved.'),
    },
    outputSchema: {
      reidentified: z.boolean().describe('Whether the ISBN changed, so the row is now a different book.'),
      withdrawn_tags: z.array(tagEntry).describe('The tags this change took off the book.'),
      book: bookDetail,
      goes_between: goesBetween,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const { book_id: bookId, ...fields } = args
    if (!Object.values(fields).some((value) => value !== undefined)) {
      return refuse('Pass at least one field to change. get_book shows what the book holds now.')
    }

    const found = await queries.getBook.handle({ id: bookId })
    if (!found) return refuse(`There is no book ${bookId}. search_books finds book ids.`)
    const current = found.book
    if (!(CATALOGUED_STATES as readonly string[]).includes(current.state)) {
      return refuse(
        `Book ${bookId} is ${current.state}, not catalogued: it is still in the scanning queue or was ` +
        'discarded, and is saved from the app.',
      )
    }

    const isbn = args.isbn === undefined ? null : resolveIsbnPair(args.isbn)
    if (isbn && !isbn.isbn13) return refuse(NOT_AN_ISBN(args.isbn!))
    const title = args.title?.trim() ?? current.title
    if (!title) return refuse('A title cannot be empty.')

    const description: BookDescription = {
      isbn13: isbn ? isbn.isbn13 : current.isbn13,
      isbn10: isbn ? isbn.isbn10 : current.isbn10,
      title,
      subtitle: args.subtitle ?? current.subtitle,
      authors: args.authors ?? found.printed,
      publisher: args.publisher ?? current.publisher,
      published: args.published ?? current.published,
      pages: args.pages ?? current.pages,
      notes: args.notes ?? current.notes,
      seriesName: args.series_name ?? current.series_name,
      seriesIndex: args.series_index === undefined ? current.series_index : args.series_index,
      classificationSource: args.genre ? 'manual' : current.classification_source,
      classificationConfidence: args.genre ? 'high' : current.classification_confidence,
      lookupSource: current.lookup_source,
      isbnSource: isbn ? 'manual' : current.isbn_source,
    }
    const reidentified = namesADifferentBook(current, description)
    const before = (await tagsOf(queries, bookId)) ?? []

    const revised = await commands.reviseBook.handle({
      bookId,
      description,
      genre: args.genre ? GENRES[args.genre] : null,
      authorFilingOverride: args.files_under?.trim() || null,
      now: now(),
    })
    const book = revised && await describeBook(queries, bookId)
    if (!book) return refuse(`There is no book ${bookId}. search_books finds book ids.`)

    const kept = new Set(book.tags.map((tag) => `${tag.slug} ${tag.source}`))
    return answer({
      reidentified,
      withdrawn_tags: before.filter((tag) => !kept.has(`${tag.slug} ${tag.source}`)),
      book,
      goes_between: between(revised.placement),
    })
  })

  server.registerTool('tag_book', {
    title: 'Tag a book',
    description:
      'Puts one book under a tag, as the person: their tag outranks anything the catalogues or the app ' +
      'guessed, and a later lookup never takes it off. A tag the vocabulary does not have yet is made. ' +
      'Tags are slug paths ("mine/signed", "subject/sand"); words are normalised, so "Lent Out" is ' +
      '"lent-out". A genre/fiction or genre/non-fiction tag decides which run the book files into, but ' +
      'only moves it when it is next saved; to move it now use update_book with genre. Tagging a book ' +
      'that already carries the tag changes nothing. Answers every tag the book now carries. list_tags ' +
      'shows the slugs in use.',
    inputSchema: {
      book_id: z.number().int().positive().describe('From search_books or get_book.'),
      tag: z.string().min(1).max(200).describe('A slug such as "mine/signed", or words, which are normalised into one.'),
      label: z.string().max(200).optional()
        .describe('How the tag reads, kept only when this makes a new tag. Defaults to what you passed as tag.'),
    },
    outputSchema: { book_id: z.number().int(), tag: z.string(), tags: z.array(tagEntry) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const slug = TagSlug.parse(args.tag)
    if (!slug) return refuse(`"${args.tag}" is not a tag. list_tags shows the slugs this catalogue uses.`)

    const applied = await commands.applyTag.handle({
      bookId: args.book_id,
      slug,
      label: (args.label ?? args.tag).trim() || slug.value,
      now: now(),
    })
    const tags = applied && await tagsOf(queries, args.book_id)
    if (!tags) return refuse(`There is no book ${args.book_id}. search_books finds book ids.`)
    return answer({ book_id: args.book_id, tag: slug.value, tags })
  })

  server.registerTool('untag_book', {
    title: 'Untag a book',
    description:
      'Takes one book out of a tag, whoever applied it: a person, the catalogues or a guess. Only that ' +
      'exact slug goes, not the tags beneath it. A later lookup that still claims the tag can bring a ' +
      'catalogue\'s copy of it back. Taking a genre tag off does not move the book until it is next saved. ' +
      'removed is false when the book did not carry the tag. Answers every tag the book still carries.',
    inputSchema: {
      book_id: z.number().int().positive().describe('From search_books or get_book.'),
      tag: z.string().min(1).max(200).describe('The slug, as get_book lists it, such as "mine/lent-out".'),
    },
    outputSchema: { book_id: z.number().int(), removed: z.boolean(), tags: z.array(tagEntry) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (args, extra) => {
    actingFor(extra.authInfo)
    const slug = TagSlug.parse(args.tag)
    if (!slug) return refuse(`"${args.tag}" is not a tag. get_book lists the tags a book carries.`)

    const before = await tagsOf(queries, args.book_id)
    const removed = before && await commands.removeTag.handle({ bookId: args.book_id, slug })
    const tags = removed && await tagsOf(queries, args.book_id)
    if (!before || !tags) return refuse(`There is no book ${args.book_id}. search_books finds book ids.`)
    return answer({
      book_id: args.book_id,
      removed: before.some((tag) => tag.slug === slug.value),
      tags,
    })
  })
}
