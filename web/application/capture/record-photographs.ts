/**
 * Somebody photographed a book, or a catalogue handed over its artwork.
 *
 * One command, and it is a statement about photographs rather than about a
 * shutter: what a caller knows about a book's photographs right now, offered to
 * be written down. The store takes what is new and keeps what it already has,
 * so a caller that knows only half of it can say half of it, and a caller that
 * repeats itself costs a statement and changes nothing.
 *
 * No transaction. `record` is one upsert per photograph and every field it
 * writes moves in one direction only, so two of them racing agree whatever order
 * they land in. That is a property of the statement rather than of a lock, which
 * is the stronger of the two and the reason there is no `CaptureTransactions`
 * port beside the repository the way there is one beside the tag repository.
 */

import type { CaptureRepository, NewPhotograph } from './ports'

/** What is known about one book's photographs. */
export interface RecordPhotographs {
  bookId: number
  photographs: readonly NewPhotograph[]
}

export class RecordPhotographsHandler {
  constructor(private readonly captures: CaptureRepository) {}

  async handle(command: RecordPhotographs): Promise<void> {
    // A photograph with no file is not a photograph. The columns this is fed
    // from default to '' rather than to null, so an empty slot arrives here as
    // an empty string, and dropping it is the difference between "no back
    // photograph" and "a back photograph called nothing".
    const real = command.photographs.filter((one) => one.file !== '')
    if (!real.length) return
    await this.captures.record(command.bookId, real)
  }
}
