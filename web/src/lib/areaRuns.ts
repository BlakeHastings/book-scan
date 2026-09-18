/**
 * Turning a page of the listing into the rows of books a bookcase actually has.
 *
 * A board is an area, decided by the area's own id, not by grouping books
 * that share a rendered location label: a label can read the same for two
 * different areas, and grouping by it can draw one board out of two
 * stretches of shelf. Boards are ordered by where their areas stand in the
 * room: the piece's ordinal, then the piece itself, then the plank on it.
 *
 * A run only reports a count once the whole listing has loaded (`closed`):
 * books arrive a page at a time in filing order, and any board can still
 * gain a book from a later page.
 *
 * A book on no area (checked out, or never placed) is left out of the
 * boards rather than drawn in one, but is still counted so the screen can
 * say so.
 */

import type { AreaStanding } from '../../shared/shelving'
import { CHECKED_OUT, WITHDRAWN, type BookState } from '../../domain/books/state'
import { pieceOn } from './furniture'

/** One row of books: an area, as it stands and as it reads. */
export interface AreaRun {
  /**
   * The area this row is.
   *
   * The identity, which is what makes this one row and not two. A label is a
   * rendering and reads differently the moment somebody names a bookcase.
   */
  areaId: number
  /** `1A`, or `Hall shelf · Cookery` where somebody has named the furniture. */
  label: string
  /**
   * Where this board stands, which is what the boards are ordered by and what
   * says when one piece of furniture has ended and the next has begun.
   */
  standing: AreaStanding
  /** What the piece is called, for the heading above the run. */
  piece: string
  books: Book[]
  /** Whether every book in this area has loaded, and so whether to count them. */
  closed: boolean
}

/** The little this needs to know about a book. */
interface Book {
  id: number
  /** The area it is standing on, or null for a book on no bookcase. */
  area_id: number | null
  location: string
  standing: AreaStanding | null
  /** Why it is off a bookcase, for the sentence that counts them. */
  state: BookState
}

/**
 * The books that are on no bookcase, counted by the reason they are not.
 *
 * `withdrawn` is a state, and `unplaced` is the absence of an area on a
 * book that is otherwise shelved: `shelved` with no plank is somebody
 * having said what a book is and not yet where it went.
 */
export interface OffTheBookcase {
  /** Lent, borrowed, in a box in the car. Still yours. */
  out: number
  /** Given away, sold, lost. */
  gone: number
  /** Catalogued and never put anywhere. */
  unplaced: number
  /** All three. */
  total: number
}

/**
 * Where two areas stand relative to each other, which is the order somebody
 * walks past them: the piece's ordinal, then the piece itself, then the
 * plank. The middle term matters because two pieces can share one ordinal
 * in this catalogue, so without it the boards of two pieces would interleave.
 */
const byWhereTheyStand = (a: AreaStanding, b: AreaStanding) =>
  a.fixture - b.fixture || a.fixtureId - b.fixtureId || a.plank - b.plank

export function areaRuns<T extends Book>(
  books: readonly T[],
  /** Whether the whole listing has loaded, or only the pages so far. */
  complete: boolean,
): { runs: AreaRun[]; off: OffTheBookcase } {
  const runs = new Map<number, AreaRun>()
  const off: OffTheBookcase = { out: 0, gone: 0, unplaced: 0, total: 0 }

  for (const book of books) {
    if (book.area_id === null || !book.standing) {
      off.total += 1
      if (book.state === CHECKED_OUT) off.out += 1
      else if (book.state === WITHDRAWN) off.gone += 1
      else off.unplaced += 1
      continue
    }

    const already = runs.get(book.area_id)
    if (already) {
      already.books.push(book)
      continue
    }

    runs.set(book.area_id, {
      areaId: book.area_id,
      label: book.location,
      standing: book.standing,
      piece: pieceOn(book.standing),
      books: [book],
      closed: complete,
    })
  }

  return {
    runs: [...runs.values()].sort((a, b) => byWhereTheyStand(a.standing, b.standing)),
    off,
  }
}
