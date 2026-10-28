/**
 * The steps cataloguing and revising a book both take between describing it and
 * saving it: who it credits, and what it files under. Two callers, one spelling,
 * so a name cannot file one way from the library and another from the shelf.
 */

import { Credits, PrintedName } from '../../../domain/authorship/authors'
import type { Book, BookDescription } from '../../../domain/books/book'
import type { GenreSlug } from '../../../domain/tagging/genre'
import { filingName } from '../../../shared/shelving'
import type { AuthorRepository } from '../../authorship/ports'

/** What a save says about a book, the same for a new one and an edit. */
export interface BookSave {
  description: BookDescription
  /** Null when the save states no genre. */
  genre: GenreSlug | null
  /** What the first-listed name files under, when somebody has said. */
  authorFilingOverride?: string | null
}

/** The filing a save resolved, in the names the wire already answers with. */
export interface ResolvedFiling {
  authorFiling: string
  titleFilingValue: string
  sortKey: string
}

/**
 * Introduce each printed name and credit the book with them, in order. A name met
 * for the first time is filed under the override when it is first-listed and one
 * was given, and under its derived filing otherwise. An override for a name
 * already met files that alias, which is somebody correcting how it files.
 */
export async function creditNames(
  authors: AuthorRepository,
  book: Book,
  printed: readonly string[],
  authorFilingOverride: string | null | undefined,
): Promise<void> {
  const override = authorFilingOverride?.trim()
  const aliasIds: number[] = []
  for (const { position, name } of Credits.of(printed).positioned) {
    const alias = await authors.introduce(name, position === 1 && override ? override : name.derivedFiling)
    if (position === 1 && override && alias.filing !== override) await authors.file(alias.id, override)
    aliasIds.push(alias.id)
  }
  book.credit(aliasIds)
}

/**
 * File the book under its first-listed name: the override when one was given,
 * then the alias's filing, then the heuristic for a name that does not parse.
 */
export async function fileBook(
  authors: AuthorRepository,
  book: Book,
  authorFilingOverride: string | null | undefined,
): Promise<ResolvedFiling> {
  const primary = book.record.authors[0] ?? ''
  const printed = PrintedName.parse(primary)
  const authorFiling = authorFilingOverride?.trim()
    || (printed
      ? (await authors.aliasFor(printed))?.filing ?? printed.derivedFiling
      : filingName(primary))

  const filed = book.file(authorFiling)
  return { authorFiling, titleFilingValue: filed.titleFiling, sortKey: filed.sortKey }
}
