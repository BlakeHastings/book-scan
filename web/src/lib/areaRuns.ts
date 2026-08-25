/**
 * Turning a page of the listing into the rows of books a bookcase actually has.
 *
 * The library draws the same books three ways and the switcher decides which,
 * so all three read one listing rather than three requests. Covers and the list
 * take it as it comes; the boards need it cut into areas, which is what this
 * does, and it does it here because it is arithmetic about the furniture and
 * belongs in a place a test can reach without a browser.
 *
 * ## One board per area, in the order the furniture stands
 *
 * A board is an area, decided by the area's own id, and the boards are ordered
 * by where their areas stand in the room: the piece's ordinal, then the piece
 * itself, then the plank on it. That is the order `slotsInOrder` puts the
 * furniture in on the server, said again over the little of it a book carries.
 *
 * **It was neither of those, and #434 is what that cost.** A board used to be
 * "books next to each other in the listing whose location label reads the same",
 * and the heading over it was a regular expression run across that label. The
 * listing arrives in filing order, so the moment a book's genre tag moved it
 * into the other run while it went on standing exactly where it was, the board
 * it was standing on was drawn a second time, in the middle of another bookcase,
 * with one book on it. One area, two boards, two counts, and nothing on the page
 * saying which was the bookcase.
 *
 * The old note here argued for consecutive over gathered: that gathering "would
 * quietly draw one board out of two stretches of shelf". That reasoning had the
 * two questions crossed. Where a book stands is the ledger's answer and it is
 * one place; where the filing order puts it is a different answer, and the two
 * disagreeing is a misfile, which is reported as a misfile on the screen built
 * for it. A picture of the room draws the room.
 *
 * ## A count is only drawn once the listing has finished
 *
 * This is the one thing paging costs the drawing, and it is worth saying rather
 * than papering over. Books arrive sixty at a time in filing order and a board
 * is a place rather than a stretch of that order, so any board can still gain a
 * book from a later page and no board is finished until the last one has
 * arrived. Writing "4 books" over a board that is about to become five is a
 * number that is wrong until somebody presses More, so a run is `closed` only
 * when everything has loaded, and only a closed run gets a count.
 *
 * ## A book on no area is not on a bookcase
 *
 * Checked out, or never placed. It is left out of the boards rather than drawn
 * in one, which is what the room looks like: the run has closed up behind it.
 * They are counted, so the screen can say so instead of quietly losing them.
 */

import type { AreaStanding } from '../../shared/shelving'
import { pieceSaid } from './furniture'

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
}

/*
 * `pieceOf` was here, and it worked the heading over a row of books back out of
 * that row's label with a regular expression.
 *
 * It is gone (#447), and it was the last place in this app that read a rendered
 * label to recover a fact about the furniture. That is the hole seven defects
 * came out of: #356 compared two renderings of one plank and hid 181 books, #380
 * would have moved a book by a stale name, #401 made a bookcase read as empty,
 * #434 drew a bookcase twice, and #430 had one fixture answering to two names on
 * two screens somebody walks between while standing at the shelf.
 *
 * It survived #446 because `GET /api/shelves` answered the ordinals the boundary
 * walk counts and had no piece to be asked about. It does now: a board carries
 * `standing`, built from the same row and the same `labelFor` that renders its
 * label, and `pieceSaid` is the one answer to what a piece is called. So a crate
 * reads "Crate 5" rather than the word this function invented for everything.
 */

/**
 * Where two areas stand relative to each other, which is the order somebody
 * walks past them.
 *
 * The piece's ordinal, then the piece itself, then the plank. The middle one is
 * not decoration and `slotsInOrder` says why: two pieces can stand on one
 * number, which is an arrangement this catalogue has, so without it the boards
 * of two pieces would interleave.
 */
const byWhereTheyStand = (a: AreaStanding, b: AreaStanding) =>
  a.fixture - b.fixture || a.fixtureId - b.fixtureId || a.plank - b.plank

export function areaRuns<T extends Book>(
  books: readonly T[],
  /** Whether the whole listing has loaded, or only the pages so far. */
  complete: boolean,
): { runs: AreaRun[]; off: number } {
  const runs = new Map<number, AreaRun>()
  let off = 0

  for (const book of books) {
    if (book.area_id === null || !book.standing) {
      off += 1
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
      piece: pieceSaid({
        name: book.standing.name,
        kind: book.standing.kind,
        position: book.standing.fixture,
      }),
      books: [book],
      closed: complete,
    })
  }

  return {
    runs: [...runs.values()].sort((a, b) => byWhereTheyStand(a.standing, b.standing)),
    off,
  }
}
