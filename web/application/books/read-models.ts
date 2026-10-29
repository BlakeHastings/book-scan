/**
 * What the catalogue's reads need from the outside world.
 *
 * A read model answers a question and holds no rule a write depends on, so
 * nothing here loads an aggregate and nothing here can change a row. The
 * shapes are the ones the wire already speaks, snake_case and all, because the
 * `/api` routes answer them unchanged and an MCP tool reading the same handler
 * should not see a second vocabulary for one book.
 */

import type { BookState, CATALOGUED_STATES } from '../../domain/books/state'
import type { TagSlug } from '../../domain/tagging/tags'
import type { AreaStanding, ShelfRange } from '../../shared/shelving'

/**
 * The most books one listing answers with, asked for or not: the cap a stated
 * `limit` is clamped to and what an absent one means, so "the largest page" and
 * "the page you get for not asking" cannot drift apart.
 */
export const PAGE_LIMIT = 500

/**
 * One book in any state, as `books` holds it, with its newest photograph of
 * each kind and where it stands. Every photograph field is '' and every
 * placement field is '' or null for a book that has none.
 */
export interface BookView {
  id: number
  isbn13: string
  isbn10: string
  title: string
  subtitle: string
  authors: string
  publisher: string
  published: string
  pages: string
  notes: string
  shelf_range: ShelfRange
  classification_source: string
  classification_confidence: string
  series_name: string
  series_index: number | null
  title_filing: string
  sort_key: string
  lookup_source: string
  isbn_source: string
  ocr_text: string
  scanned_at: string
  state: BookState
  title_guess: string
  cover_text: string
  analysed: string
  draft_json: string
  edit_json: string
  edited_by: string
  edited_at: string | null
  scan_note: string
  claimed_by: string
  claimed_at: string | null
  processed_at: string | null
  cover_checked_at: string | null

  front_image: string
  back_image: string
  edge_image: string
  cover_image: string
  front_crop: string
  back_crop: string
  edge_crop: string
  cropped: string
  front_hash: string
  cover_hash: string

  location: string
  area_id: number | null
  standing: AreaStanding | null
  checked_out_at: string | null
}

/**
 * A book read out of the catalogue rather than by id: it carries the name its
 * first credit files under, which the views join on and `books` does not have.
 */
export interface CataloguedBookView extends BookView {
  author_filing: string
}

export type CataloguedState = (typeof CATALOGUED_STATES)[number]

/**
 * What a listing is narrowed by. Every field is optional and an absent one
 * narrows nothing, so `{}` is the whole catalogue.
 */
export interface CatalogueFilter {
  /** One run of the collection. Absent or null means both, in bookcase order. */
  range?: ShelfRange | null
  /** Titles and the names on the cover, near enough rather than exact. */
  words?: string
  /** Either form of the number. */
  isbn?: string
  /** All of which the book must carry, itself or under. */
  tags?: readonly TagSlug[]
  /** Credited to any of this person's names, at any position. */
  authorId?: number
  /** One of the three states a catalogued book can be in. Absent means all three. */
  state?: CataloguedState
  /**
   * Whether the book stands on a plank. `false` implies `shelved`, because a
   * book that is out or withdrawn is not waiting to be placed.
   */
  placed?: boolean
}

/** A page already decided: the read model does not clamp. */
export interface Page {
  limit: number
  offset: number
}

export interface CatalogueCounts {
  total: number
  fiction: number
  nonfiction: number
  checkedOut: number
  /** Shelved and on no plank: the predicate `placed: false` narrows by. */
  unplaced: number
}

/**
 * The catalogue as `catalogued_books` answers it (`shelved`, `checked_out`,
 * `withdrawn`), except `detail`, which is a lookup by id and answers a book in
 * any state, queued and discarded included, and `randomShelvedId`, which reads
 * only what is on the shelves.
 */
export interface CatalogueReadModel {
  /**
   * One page, fiction then non-fiction, each in shelf order. `total` is what
   * the filter matched rather than what the page holds.
   */
  list(filter: CatalogueFilter, page: Page): Promise<{ books: CataloguedBookView[]; total: number }>

  /** The whole catalogue, whatever any listing was narrowed by. */
  counts(): Promise<CatalogueCounts>

  /** The catalogued book with this number in either form, or null. */
  findByIsbn(isbn: string): Promise<CataloguedBookView | null>

  /** One book in any state, or null when there is no such row. */
  detail(id: number): Promise<BookView | null>

  /**
   * One shelved book, chosen uniformly at random, or null when nothing is on
   * the shelves. Shelved and not catalogued: a book that is out or withdrawn
   * is not on the shelf to be pulled off it.
   */
  randomShelvedId(): Promise<number | null>

  /**
   * The names as printed on the book, in printed order. `BookView.authors` is
   * these joined with a comma, which a name with a comma in it cannot be read
   * back out of.
   */
  printedNames(id: number): Promise<string[]>
}

/** One catalogued book, and how much of what it prints on its cover a photograph's text holds. */
export interface CoverTextMatch {
  id: number
  title: string
  /** The first credit's name as printed, or '' for a book with none. */
  author: string
  /** 0 to 1: trigram similarity of the title and the whole text. */
  titleSimilarity: number
  /** The same for the first author's printed name; 0 for a book with none. */
  authorSimilarity: number
  /** 0 to 1: how much of the title appears as one stretch of the text (trigram word similarity). */
  titlePrinted: number
}

/** The catalogue as the words on a cover photograph find it. */
export interface CoverTextReadModel {
  /**
   * The catalogued books among the `candidates` titles nearest `text` and the
   * books of the `candidates` printed names nearest it, each scored against
   * the whole of `text`, which is lower case and unaccented. Unordered:
   * ranking is the handler's.
   */
  near(text: string, candidates: number): Promise<CoverTextMatch[]>
}

/*
 * The three ways a cover photograph is recognised, as the fused matcher
 * (`queries/match-cover.ts`) asks them. Each answers catalogued books best
 * first. They are ports rather than the handlers behind them because a query
 * may import nothing but read models: the app hands over `NearestCoversHandler`,
 * `MatchCoverTextHandler` and the hash, and the harness hands over the same
 * text handler beside its own in-memory picture and hash.
 */

/** A book as an image model sees the photograph: `similarity` is a cosine, 1 the same direction. */
export interface PictureMatch {
  id: number
  similarity: number
}

export interface CoverPictures {
  /** Most alike first, or null when the image model is not loaded, which is a state and not a failure. */
  nearest(photo: Uint8Array, limit: number): Promise<PictureMatch[] | null>
}

/** A book as the words read off a photograph find it, scored by `coverTextScore`. */
export interface WordsMatch {
  id: number
  title: string
  /** The first credit's name as printed, or ''. */
  author: string
  /** 0 to 1, what the text ranks by. */
  score: number
  /** 0 to 1: how much of the title is printed on the cover as one stretch. */
  titlePrinted: number
}

export interface CoverWords {
  /** Best first; nothing for a reading with no word in it worth finding a book by. */
  near(reading: string, limit: number): Promise<WordsMatch[]>
}

/** A book by the perceptual hash: `distance` is differing bits out of 64. */
export interface HashMatch {
  id: number
  distance: number
}

export interface CoverHashes {
  /** Nearest first, none past `within` bits. */
  near(photo: Uint8Array, within: number, limit: number): Promise<HashMatch[]>
}
