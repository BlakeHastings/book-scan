/**
 * The two things a person does to the vocabulary of names: file one differently,
 * and say that two of them are the same person.
 *
 * **Both exist because the backfill deliberately did neither.** #180's migration
 * gave every distinct printed name an author of its own and took each filing
 * name from the book row that already used it, because merging two people later
 * is one statement and splitting one that swallowed two is not recoverable at
 * all. These are that later statement, and the reason the conservatism was safe
 * rather than merely cautious.
 */

import { Author } from '../../domain/authorship/authors'
import type { AuthorRepository } from './ports'

/** Somebody says this name files under something else. */
export interface FileAlias {
  aliasId: number
  filing: string
}

/**
 * The override table's whole job, as a command.
 *
 * `author_filing` existed because no heuristic gets `García Márquez` and
 * `Le Guin` both right, and a corrected filing name had to be stored once and
 * reused. It is stored on the alias now, so this writes the fact rather than an
 * exception to a rule applied on the way past.
 */
export class FileAliasHandler {
  constructor(private readonly authors: AuthorRepository) {}

  async handle(command: FileAlias): Promise<void> {
    const filing = command.filing.trim()
    if (!filing) throw new Error('a name has to file under something')
    await this.authors.file(command.aliasId, filing)
  }
}

/** Somebody says these two are one person. */
export interface MergeAuthors {
  /** The author who keeps their primary name. */
  intoId: number
  /** The author who is emptied. Their names move; the row goes. */
  fromId: number
}

export class MergeAuthorsHandler {
  constructor(private readonly authors: AuthorRepository) {}

  /**
   * Answers the author that results, so a caller can show what it now covers.
   *
   * The domain decides what merging means, and it is asked before the store is
   * told: `Author.absorbing` is what says every alias keeps its own printed and
   * filing name, which is what makes this move no book on any shelf.
   */
  async handle(command: MergeAuthors): Promise<Author> {
    if (command.intoId === command.fromId) {
      throw new Error('an author is already themselves')
    }

    const into = await this.authors.find(command.intoId)
    const from = await this.authors.find(command.fromId)
    if (!into) throw new Error(`there is no author ${command.intoId}`)
    if (!from) throw new Error(`there is no author ${command.fromId}`)

    const merged = into.author.absorbing(from.author)
    await this.authors.absorb(command.intoId, command.fromId)
    return merged
  }
}
