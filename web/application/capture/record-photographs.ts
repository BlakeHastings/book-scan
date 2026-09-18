/**
 * Somebody photographed a book, or a catalogue handed over its artwork.
 *
 * A statement about what is known right now, not about a shutter event: the
 * store keeps what it already has and adds what is new, so repeating a call
 * changes nothing.
 *
 * No transaction: `record` is one upsert per photograph, and every field it
 * writes moves in one direction only, so two calls racing agree whatever
 * order they land in.
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
    // The columns default to '' not null, so an empty slot arrives as an empty string; dropping it distinguishes "no photo" from "a photo called nothing".
    const real = command.photographs.filter((one) => one.file !== '')
    if (!real.length) return
    await this.captures.record(command.bookId, real)
  }
}
