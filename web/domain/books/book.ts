/**
 * A book: what it is, what it carries, who wrote it and where it files.
 *
 * Every invariant below is held by exactly one method, and nothing outside this
 * class changes the fields they protect:
 *
 * | Invariant | Method |
 * | --- | --- |
 * | the title is not empty; the ISBN pair is resolved, and kept raw when it does not resolve | `describe` |
 * | a save moves a queued book to shelved and never changes shelved, checked out or withdrawn | `shelve` |
 * | a different ISBN withdraws what was said about the old book, before the genre is read | `revise` |
 * | a source restates only its own tags, so automation never retracts a person's | `restate` |
 * | a person's genre withdraws the guess, never the reverse | `stateGenre` |
 * | `shelf_range` is written only by a save | `stateGenre` |
 * | `sort_key` and `title_filing` are derived only by a save or a refile | `file` |
 * | credits are deduplicated and numbered 1..n | `credit` |
 *
 * Where the book stands is not here. The placement ledger is appended to by the
 * save handler beside the repository's write, on the same unit of work.
 */

import { resolveIsbnPair, normaliseIsbn } from '../../shared/isbn'
import { buildSortKey, titleFiling, type ShelfRange } from '../../shared/shelving'
import { GENRE, SUBJECT } from '../tagging/catalogue-claims'
import { genreStatedBy, rangeOfGenre, type StatedGenre } from '../tagging/genre'
import {
  BookTags, type AppliedTag, type TagClaim, type TagConfidence, type TagSlug, type TagSource,
} from '../tagging/tags'
import { isQueued, SHELVED, type BookState } from './state'

/** What somebody says a book is, as a save carries it. */
export interface BookDescription {
  isbn13?: string
  isbn10?: string
  title: string
  subtitle?: string
  /** As printed, in the order printed. */
  authors: readonly string[]
  publisher?: string
  published?: string
  pages?: string
  notes?: string
  seriesName?: string | null
  seriesIndex?: number | null
  classificationSource?: string
  classificationConfidence?: string
  lookupSource?: string
  isbnSource?: string
}

/** The description as the row holds it: every field present. */
export interface BookRecord {
  isbn13: string
  isbn10: string
  title: string
  subtitle: string
  /** Trimmed and non-empty, in the order printed. `book_authors` is written from this. */
  authors: readonly string[]
  publisher: string
  published: string
  pages: string
  notes: string
  seriesName: string
  seriesIndex: number | null
  classificationSource: string
  classificationConfidence: string
  lookupSource: string
  isbnSource: string
}

export interface Filing {
  titleFiling: string
  sortKey: string
}

/** A tag being written onto a book. */
export interface TagWrite {
  slug: TagSlug
  source: TagSource
  confidence: TagConfidence
  addedAt: string
}

/**
 * One change to what the book carries, in the order it was made. `source`
 * absent on a retraction means every source's row goes.
 */
export type TagChange =
  | { kind: 'retract'; slugs: readonly TagSlug[]; source?: TagSource }
  | { kind: 'apply'; writes: readonly TagWrite[] }

/** A book as the repository read it back. */
export interface StoredBook {
  id: number
  state: BookState
  record: BookRecord
  tags: readonly AppliedTag[]
  /** Null for the empty range, a book in neither run. */
  shelfRange: ShelfRange | null
  filing: Filing
  /** Alias ids, position 1 first. */
  credits: readonly number[]
}

/** What the repository has to write. */
export interface BookChanges {
  /** The row and its printed names. */
  row: boolean
  credits: boolean
  tags: readonly TagChange[]
}

/**
 * Namespaces whose tags describe the work rather than this copy: every source's
 * row under one is wrong about a different book, and everything else (a shelf a
 * person keeps it on, a word they use for it) is about the copy in their hand.
 */
export const ABOUT_THE_WORK: readonly TagSlug[] = [GENRE, SUBJECT]

export class UntitledBook extends Error {
  constructor() {
    super('A title is required.')
  }
}

export class Book {
  private rowChanged = false
  private creditsChanged = false
  private tagChanges: TagChange[] = []

  private constructor(
    private bookId: number | null,
    private current: BookState,
    private described: BookRecord,
    private carried: AppliedTag[],
    private range: ShelfRange | null,
    private filed: Filing,
    private credited: number[],
  ) {}

  /** A book nobody has a row for yet, put on a shelf by the save that describes it. */
  static catalogue(description: BookDescription): Book {
    const book = new Book(null, SHELVED, describe(description, 'auto'), [], null,
      { titleFiling: '', sortKey: '' }, [])
    book.rowChanged = true
    return book
  }

  static restore(stored: StoredBook): Book {
    return new Book(stored.id, stored.state, stored.record, [...stored.tags],
      stored.shelfRange, stored.filing, [...stored.credits])
  }

  get id(): number | null { return this.bookId }
  get state(): BookState { return this.current }
  get record(): BookRecord { return this.described }
  get tags(): readonly AppliedTag[] { return this.carried }
  get shelfRange(): ShelfRange | null { return this.range }
  get filing(): Filing { return this.filed }
  get credits(): readonly number[] { return this.credited }

  /**
   * A queued book is saved at the shelf: what it is, and that it is now on one.
   * Withdraws nothing, because the identifier proposed this ISBN and the person
   * is confirming or correcting a proposal rather than saying the row was ever a
   * different book.
   */
  confirm(description: BookDescription): void {
    this.described = describe(description, 'manual')
    this.shelve()
  }

  /**
   * An edit to a book. When it names a different book than the row did,
   * `reidentify` runs first, so the old book's genre is off before `stateGenre`
   * reads the new one back.
   */
  revise(description: BookDescription): void {
    if (namesADifferentBook(this.described, description)) this.reidentify()
    this.described = describe(description, 'manual')
    this.shelve()
  }

  /**
   * Somebody has said this row is a different book. Every source's tag about the
   * work goes, a person's included: it is the person withdrawing what was said
   * about a book this no longer is, not automation overruling them.
   */
  reidentify(): void {
    const tags = BookTags.of(this.carried)
    const stale = new Map<string, TagSlug>()
    for (const prefix of ABOUT_THE_WORK) {
      for (const tag of tags.at(prefix)) stale.set(tag.slug.value, tag.slug)
    }
    if (!stale.size) return
    this.carried = this.carried.filter((tag) => !stale.has(tag.slug.value))
    this.tagChanges.push({ kind: 'retract', slugs: [...stale.values()] })
  }

  /**
   * Write the genre this save states, and answer the range the book's genre tags
   * now put it in, which is what the row is written with. A save that states
   * nothing restates nothing and reads back what is already there.
   */
  stateGenre(stated: StatedGenre, now: string): ShelfRange | null {
    const { tag } = genreStatedBy(stated)
    if (tag) {
      this.restate(tag.source, [{ slug: tag.slug, confidence: tag.confidence }], GENRE, now)
      if (tag.source === 'person') this.restate('guess', [], GENRE, now)
    }

    const range = rangeOfGenre(this.carried)
    // The claim above was written or was already there, so its absence here is
    // a broken restatement rather than a state the model allows.
    if (tag && !range) throw new Error(`book ${this.bookId} carries no genre tag after a save that stated one`)
    this.range = range
    this.rowChanged = true
    return range
  }

  /**
   * What one source says now about one part of the vocabulary (`within`, or all
   * of it). Only that source's rows are looked at, so nothing a person said can
   * be taken back by a lookup or a guess.
   */
  restate(source: TagSource, claims: readonly TagClaim[], within: TagSlug | undefined, now: string): void {
    const { retracted, applied } = BookTags.of(this.carried).restatedBy(source, claims, within)

    if (retracted.length) {
      const gone = new Set(retracted.map((tag) => tag.slug.value))
      this.carried = this.carried.filter((tag) => tag.source !== source || !gone.has(tag.slug.value))
      this.tagChanges.push({ kind: 'retract', slugs: retracted.map((tag) => tag.slug), source })
    }

    if (applied.length) {
      const writes = applied.map((claim) => ({
        slug: claim.slug, source, confidence: claim.confidence, addedAt: now,
      }))
      for (const write of writes) this.carry(write)
      this.tagChanges.push({ kind: 'apply', writes })
    }
  }

  /** A person puts the book under a tag. */
  applyTag(slug: TagSlug, confidence: TagConfidence, now: string): void {
    const write: TagWrite = { slug, source: 'person', confidence, addedAt: now }
    this.carry(write)
    this.tagChanges.push({ kind: 'apply', writes: [write] })
  }

  /**
   * A person takes the book out of a tag, whoever put it there. Not remembered:
   * a later lookup still claiming it brings it back.
   */
  removeTag(slug: TagSlug): void {
    this.carried = this.carried.filter((tag) => !tag.slug.equals(slug))
    this.tagChanges.push({ kind: 'retract', slugs: [slug] })
  }

  /**
   * Who the book credits, as alias ids in printed order. An alias named twice is
   * one credit, first position winning; the repository numbers them from 1.
   */
  credit(aliasIds: readonly number[]): void {
    this.credited = [...new Set(aliasIds)]
    this.creditsChanged = true
  }

  /** Where the book files, from what its first-listed name files under. */
  file(authorFiling: string): Filing {
    this.filed = {
      titleFiling: titleFiling(this.described.title),
      sortKey: buildSortKey({
        authorFiling,
        title: this.described.title,
        seriesName: this.described.seriesName,
        seriesIndex: this.described.seriesIndex,
      }),
    }
    this.rowChanged = true
    return this.filed
  }

  /** What a save has to write. */
  get changes(): BookChanges {
    return { row: this.rowChanged, credits: this.creditsChanged, tags: this.tagChanges }
  }

  /** The repository has written the changes, and this is the row's id. */
  saved(id: number): void {
    this.bookId = id
    this.rowChanged = false
    this.creditsChanged = false
    this.tagChanges = []
  }

  private shelve(): void {
    if (isQueued(this.current)) this.current = SHELVED
    this.rowChanged = true
  }

  private carry(write: TagWrite): void {
    const at = this.carried.findIndex((tag) => tag.slug.equals(write.slug) && tag.source === write.source)
    const tag = { slug: write.slug, source: write.source, confidence: write.confidence }
    if (at === -1) this.carried.push(tag)
    else this.carried[at] = tag
  }
}

/**
 * The record a description means. `classificationSource` defaults differently
 * for a new book and an edit, which is what the two save statements always did.
 */
function describe(description: BookDescription, unclassified: 'auto' | 'manual'): BookRecord {
  const title = description.title.trim()
  if (!title) throw new UntitledBook()

  // Both forms from whichever was given, because duplicate detection searches
  // both; what was typed is kept when it is not an ISBN at all.
  const isbn = resolveIsbnPair(description.isbn13 || description.isbn10 || '')
  return {
    isbn13: isbn.isbn13 || description.isbn13 || '',
    isbn10: isbn.isbn10 || description.isbn10 || '',
    title,
    subtitle: description.subtitle ?? '',
    authors: description.authors.map((name) => name.trim()).filter(Boolean),
    publisher: description.publisher ?? '',
    published: description.published ?? '',
    pages: description.pages ?? '',
    notes: description.notes ?? '',
    seriesName: description.seriesName ?? '',
    seriesIndex: description.seriesIndex ?? null,
    classificationSource: description.classificationSource ?? unclassified,
    classificationConfidence: description.classificationConfidence ?? 'unknown',
    lookupSource: description.lookupSource ?? '',
    isbnSource: description.isbnSource ?? '',
  }
}

/**
 * The one ISBN a row names, or '' when it names none. Resolved, so the ten and
 * thirteen digit forms of one book are one identity; the bare digits stand in
 * for a value that is not an ISBN, since that is still what somebody's tags
 * were about.
 */
function identityOf(row: { isbn13?: string; isbn10?: string }): string {
  const named = row.isbn13 || row.isbn10 || ''
  const pair = resolveIsbnPair(named)
  return pair.isbn13 || pair.isbn10 || normaliseIsbn(named)
}

/**
 * Whether a description corrects which book a row is. A row that named no ISBN
 * carried nothing about a different book, so filling one in takes nothing away.
 */
export function namesADifferentBook(
  before: { isbn13?: string; isbn10?: string },
  after: { isbn13?: string; isbn10?: string },
): boolean {
  const was = identityOf(before)
  return was !== '' && was !== identityOf(after)
}
