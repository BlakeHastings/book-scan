/**
 * `Photographs` over `server/photographs.ts`, the one place a filename becomes a
 * `capture` row, on whatever transaction the `Db` is in.
 */

import type { PhotographFiles, Photographs } from '../../application/books/ports'
import type { Db } from '../../server/driver'
import { photographsTaken } from '../../server/photographs'

export class DbPhotographs implements Photographs {
  constructor(private readonly db: Db) {}

  taken(bookId: number, files: PhotographFiles, at: string): Promise<void> {
    return photographsTaken(this.db, bookId, files, at)
  }
}
