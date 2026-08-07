/**
 * A book says who wrote it.
 *
 * The one command every save goes through. It takes the printed names the way
 * they arrive from a catalogue or from somebody typing, introduces any this
 * collection has not seen, and restates the book's credits as exactly those, in
 * order.
 *
 * **Restating rather than adding**, because a save is the whole answer to "who
 * wrote this". An edit that removes a co-author has to remove the credit, and an
 * edit that reorders them has to reorder them, which "add what is new" cannot do.
 *
 * **The filing name is only ever set when a name is first seen.** After that it
 * belongs to whoever files books: re-saving a book must not undo the correction
 * somebody made to how its author files, which is exactly what deriving the
 * filing name on every save would do. `AuthorRepository.introduce` is where that
 * holds; this command only says what the derived answer would be for a name
 * nobody has filed yet.
 */

import { Credits, PrintedName } from '../../domain/authorship/authors'
import type { AuthorRepository } from './ports'

export interface CreditBook {
  bookId: number
  /** As printed, in the order they are printed. */
  authors: readonly string[]
  /**
   * What the first-listed name should file under, when somebody has said.
   *
   * The same override the save route already carries as `authorFilingOverride`,
   * and it applies to the first-listed name because that is the one the shelf
   * orders by. It is ignored for a name that is already filed, for the reason
   * above.
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
