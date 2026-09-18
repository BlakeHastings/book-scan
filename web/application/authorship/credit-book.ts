/**
 * A book says who wrote it. The one command every save goes through: it
 * introduces any name this collection has not seen and restates the book's
 * credits as exactly the given names, in order (not adds), since a save is
 * the whole answer to "who wrote this".
 *
 * The filing name is set only when a name is first seen: after that it
 * belongs to whoever files books, and re-saving a book must not undo a
 * correction to how its author files. `AuthorRepository.introduce` enforces
 * this; this command only supplies the derived filing for a name not yet filed.
 */

import { Credits, PrintedName } from '../../domain/authorship/authors'
import type { AuthorRepository } from './ports'

export interface CreditBook {
  bookId: number
  /** As printed, in the order they are printed. */
  authors: readonly string[]
  /**
   * What the first-listed name should file under, when somebody has said.
   * Applies only to the first-listed name (the one the shelf orders by), and
   * is ignored once that name is already filed.
   */
  filingOverride?: string | null
}

export class CreditBookHandler {
  constructor(private readonly authors: AuthorRepository) {}

  async handle(command: CreditBook): Promise<void> {
    const credits = Credits.of(command.authors)
    const override = command.filingOverride?.trim()

    const aliasIds: number[] = []
    for (const { position, name } of credits.positioned) {
      const filing = position === 1 && override ? override : name.derivedFiling
      aliasIds.push((await this.authors.introduce(name, filing)).id)
    }

    await this.authors.credit(command.bookId, aliasIds)
  }
}

/** The printed name a person's typing means, or null when it means nothing. */
export function nameFor(typed: string): PrintedName | null {
  return PrintedName.parse(typed)
}
