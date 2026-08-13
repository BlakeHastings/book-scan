/**
 * Turning a page of the listing into the rows of books a bookcase actually has.
 *
 * The library draws the same books three ways and the switcher decides which,
 * so all three read one listing rather than three requests. Covers and the list
 * take it as it comes; the boards need it cut into areas, which is what this
 * does, and it does it here because it is arithmetic about labels and belongs in
 * a place a test can reach without a browser.
 *
 * ## Consecutive, not gathered
 *
 * A run is books next to each other in filing order that share a label, and it
 * is deliberately not "every book whose label is 1A". The listing arrives in the
 * order the shelf stands in, so consecutive is what a plank is; gathering by
 * label would quietly draw one board out of two stretches of shelf if a book
 * ever sat between them wearing a different label, which is exactly the state a
 * misfiled book is in and exactly the thing somebody is looking at the library
 * to find.
 *
 * ## A count is only drawn for a run that has finished
 *
 * This is the one thing paging costs the drawing, and it is worth saying rather
 * than papering over. The listing arrives sixty books at a time, so the last run
 * of what has loaded is usually half an area: writing "4 books" over it would be
 * a number that is wrong until somebody scrolls. A run is `closed` when another
 * run follows it or when everything has loaded, and only a closed run gets a
 * count.
 *
 * ## A book with no label is not on a bookcase
 *
 * Checked out, or never placed. It is left out of the boards rather than drawn
 * in one, which is what the room looks like: the run has closed up behind it.
 * They are counted, so the screen can say so instead of quietly losing them, and
 * a book between two books of the same area does not split that area in two.
 */

/** One row of books: an area, as the label reads off the furniture. */
export interface AreaRun {
  /** `1A`, or `Hall shelf · Cookery` where somebody has named the furniture. */
  label: string
  /** What the piece of furniture is called, for the heading above the run. */
  piece: string
  books: Book[]
  /** Whether every book in this area has loaded, and so whether to count them. */
  closed: boolean
}

/** The little this needs to know about a book. */
interface Book {
  id: number
  location: string
}

/**
 * What the heading over a run says.
 *
 * A derived label is either a number and a letter, or a name and an area with a
 * middle dot between them, so the piece is whichever half is in front. Never
 * "Bookcase" over something somebody has called the hall shelf, and never a bare
 * number over a bookcase they have not named.
 */
export function pieceOf(label: string): string {
  const named = label.split(' · ')
  if (named.length > 1) return named[0]!.trim()

  const plank = /^\s*[Ss]?(\d+)\s*[A-Za-z]*\s*$/.exec(label)
  return plank ? `Bookcase ${plank[1]}` : label
}

export function areaRuns<T extends Book>(
  books: readonly T[],
  /** Whether the whole listing has loaded, or only the pages so far. */
  complete: boolean,
): { runs: AreaRun[]; off: number } {
  const runs: AreaRun[] = []
  let off = 0

  for (const book of books) {
    if (!book.location) {
      off += 1
      continue
    }

    const last = runs[runs.length - 1]
    if (last && last.label === book.location) {
      last.books.push(book)
      continue
    }
    runs.push({ label: book.location, piece: pieceOf(book.location), books: [book], closed: true })
  }

  // Only the final run can still be growing, and only while there is more to
  // load. Every one before it is closed by the run that follows it.
  const last = runs[runs.length - 1]
  if (last && !complete) last.closed = false

  return { runs, off }
}
