/**
 * The two things a person does to the vocabulary of names: file one
 * differently, and say that two of them are the same person.
 *
 * Both exist because the initial migration deliberately gave every distinct
 * printed name its own author: merging later is one statement, but splitting
 * one that wrongly swallowed two is not recoverable.
 */

import { Author } from '../../domain/authorship/authors'
import type { AuthorRepository } from './ports'

/** Somebody says this name files under something else. */
export interface FileAlias {
  aliasId: number
  filing: string
}

/**
 * `author_filing` exists because no heuristic gets `García Márquez` and
 * `Le Guin` both right. Stored on the alias, as a fact rather than an
 * exception applied on the way past.
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
   * `Author.absorbing` decides the merge before the store is told: every
   * alias keeps its own printed and filing name, so no book moves on the shelf.
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
