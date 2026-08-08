/**
 * `OutstandingMoveRepository` over Drizzle, executed through `Db`.
 *
 * The same shape as `DrizzleSeparatorRepository` beside it, including the
 * hand-spelled insert and the hand-written hydration, and for the same reasons
 * written out there.
 *
 * ## The one column that is not a column
 *
 * `restore` holds JSON. It is the only place in this schema that does, so it is
 * worth saying what makes it different from the alternative rather than leaving
 * it to look like a shortcut.
 *
 * What has to be stored is "the boundaries this one move touched, and what each
 * of them was". That is a list, of two shapes, whose entries are meaningful only
 * together and only until the move is settled or taken back. Nothing queries it,
 * nothing joins to it, nothing aggregates it, and nothing outside the retraction
 * reads it at all. A child table would give every one of those an index and a
 * foreign key it has no use for, and would still not be able to reference the
 * separators the move deleted, which are half of what the receipt is for.
 *
 * The cost is that a malformed value is a runtime error rather than a schema
 * error, so it is parsed defensively: a row that does not read back as a receipt
 * is reported as no receipt at all, which leaves the move outstanding and the
 * person with the "Moved it" they always had.
 */

import { eq, sql } from 'drizzle-orm'
import type {
  NewSeparator, OutstandingMove, OutstandingMoveRepository,
} from '../../application/shelving/ports'
import type { ShelfRange } from '../../shared/shelving'
import type { Db } from '../../server/driver'
import { build, statement } from '../db/query'
import { outstandingMove } from '../db/schema'

/** A row as the driver hands it back: column names, not domain names. */
interface OutstandingMoveRow {
  book_id: number
  shelf_range: ShelfRange
  from_label: string
  to_label: string
  restore: string
  made_at: string
}

/** The part of a receipt that is not already a column. */
interface Restore {
  reanchor: { id: number; startsAt: string }[]
  recreate: NewSeparator[]
}

const EMPTY: Restore = { reanchor: [], recreate: [] }

/**
 * Read `restore` back, or say the row carries nothing usable.
 *
 * Written to be survivable rather than strict. A receipt is a convenience on
 * top of a move that has already happened, so a value this cannot make sense of
 * has to leave the book exactly as it would have been without the receipt:
 * still moved, still reported, still closable by walking to the shelf.
 */
function parseRestore(value: string): Restore {
  try {
    const parsed = JSON.parse(value) as Partial<Restore>
    return {
      reanchor: Array.isArray(parsed.reanchor) ? parsed.reanchor : [],
      recreate: Array.isArray(parsed.recreate) ? parsed.recreate : [],
    }
  } catch {
    return EMPTY
  }
}

const toMove = (row: OutstandingMoveRow): OutstandingMove => ({
  bookId: row.book_id,
  range: row.shelf_range,
  from: row.from_label,
  to: row.to_label,
  ...parseRestore(row.restore),
})

/**
 * Merge a new move into whatever is already outstanding for the book.
 *
 * The older entry wins for a boundary named twice, because the receipt says
 * where things were the last time this book and its shelf agreed, and the older
 * one is the only entry that still points there. `from` is older for the same
 * reason: it is where the book physically is, and no move changes that.
 */
function merged(existing: OutstandingMove | undefined, made: OutstandingMove): OutstandingMove {
  if (!existing) return made

  const already = new Set(existing.reanchor.map((one) => one.id))
  return {
    ...made,
    from: existing.from,
    reanchor: [
      ...existing.reanchor,
      ...made.reanchor.filter((one) => !already.has(one.id)),
    ],
    recreate: [...existing.recreate, ...made.recreate],
  }
}

export class DrizzleOutstandingMoveRepository implements OutstandingMoveRepository {
  constructor(private readonly db: Db) {}

  async record(move: OutstandingMove, madeAt: string): Promise<void> {
    const receipt = merged(await this.forBook(move.bookId), move)
    // Deleted and re-inserted rather than upserted: the caller is already
    // inside the transaction that made the move, and one row keyed by one book
    // has nothing to gain from ON CONFLICT beyond a second dialect to be right
    // about.
    await this.clear(move.bookId)

    const written: Record<string, unknown> = {
      [outstandingMove.bookId.name]: receipt.bookId,
      [outstandingMove.shelfRange.name]: receipt.range,
      [outstandingMove.fromLabel.name]: receipt.from,
      [outstandingMove.toLabel.name]: receipt.to,
      [outstandingMove.restore.name]: JSON.stringify({
        reanchor: receipt.reanchor,
        recreate: receipt.recreate,
      } satisfies Restore),
      [outstandingMove.madeAt.name]: madeAt,
    }
    const names = Object.keys(written)

    const query = statement(sql`
      insert into ${outstandingMove} (${sql.join(names.map((name) => sql.identifier(name)), sql`, `)})
      values (${sql.join(Object.values(written).map((value) => sql`${value}`), sql`, `)})
    `)
    await this.db.run(query.text, query.values)
  }

  async forBook(bookId: number): Promise<OutstandingMove | undefined> {
    const query = statement(
      build.select().from(outstandingMove).where(eq(outstandingMove.bookId, bookId)),
    )
    const row = await this.db.get<OutstandingMoveRow>(query.text, query.values)
    return row ? toMove(row) : undefined
  }

  async inRange(range: ShelfRange): Promise<OutstandingMove[]> {
    const query = statement(
      build.select().from(outstandingMove).where(eq(outstandingMove.shelfRange, range)),
    )
    return (await this.db.all<OutstandingMoveRow>(query.text, query.values)).map(toMove)
  }

  async clear(bookId: number): Promise<void> {
    const query = statement(
      build.delete(outstandingMove).where(eq(outstandingMove.bookId, bookId)),
    )
    await this.db.run(query.text, query.values)
  }
}
