import type { PlacementResponse, PlacementStrip } from '../lib/api'
import { Instruction } from '../design/Card'
import { Shelf } from '../design/Shelf'
import { placing } from '../lib/bookLook'
import { PlacementCard } from './PlacementCard'

/**
 * How a placement is shown, wherever it is shown.
 *
 * Both the detail view and the shelving step answer the same question, so
 * they answer it the same way. Falls back to the old card when a placement
 * arrives without a strip, which is what an empty range or an older server
 * would give.
 */
export function PlacementView({
  placement, pending, instruction = true, inHand, onOpen,
}: {
  placement: PlacementResponse | null
  pending: boolean
  /**
   * Whether to spell the placement out in words as well as drawing it. The
   * shelving step wants both; the detail view does not, because there the
   * drawing is context rather than an instruction to act on.
   */
  instruction?: boolean
  /**
   * What the book in somebody's hand is called, said under the board.
   *
   * The title where the caller knows it, which is what the drawing says and
   * what a person walking to a shelf is holding. Falls back to the filing name,
   * which is the only name a placement carries on its own.
   */
  inHand?: string
  /**
   * Jump to another book in the row. The detail view passes this, so the
   * neighbours you are looking at are the way to reach them (#81). The
   * shelving step does not: there you are holding a book, and walking off to
   * a different record mid-placement loses it.
   */
  onOpen?: (id: number) => void
}) {
  if (!placement?.strip) {
    return <PlacementCard placement={placement} pending={pending} saved={false} />
  }

  return (
    <div className={pending ? 'placement--stale' : ''}>
      {instruction && <Instruction>{placement.instruction}</Instruction>}
      <ShelfStrip
        strip={placement.strip}
        inHand={inHand || placement.authorFiling}
        onOpen={onOpen}
      />
    </div>
  )
}

interface Props {
  strip: PlacementStrip
  /** What the book being placed is called, said under the board. */
  inHand: string
  onOpen?: (id: number) => void
}

/**
 * The shelf drawn end on, the way it looks when you are standing at it.
 *
 * A predecessor and a successor tell you what to look for but not what you
 * are looking at. Five books to the left and two to the right is a different
 * search from two and five, and a pair of names cannot say which. Here the
 * row is drawn whole, and the gap is in its actual place.
 *
 * The counts in the header are the reason this wrapper exists at all: they
 * belong to a placement, which has a gap to count either side of.
 *
 * ## The board is the design system's, and that settles the last disagreement
 *
 * This drew its own run of books, and `design/Shelf.tsx` drew the gallery's.
 * #399 took the library rows off this file and left it the one job its name is
 * for, and said outright that the design system wins where the two differ:
 * how wide a book is, what marks the one a screen is about, whether a spine
 * carries a number, and whether a run ends in anything. The placing strip was
 * the last place the app's answers survived, and it is the screen most people
 * see most often, so it was also the place the two would have drifted furthest.
 *
 * There is nothing left here but the arithmetic a placement has and a shelf
 * does not: which side of the hole each book is on, and what the book in your
 * hand is called. `Shelf` draws the rest, `lib/bookLook.ts` turns the row into
 * spines, and both are the same ones the book's own page and the library are
 * already drawn with.
 *
 * **The book in your hand is said under the board rather than hung below the
 * hole.** It used to be a spine dangling out of the row with the filing name
 * written down it, which is a book drawn in a place no book is: the whole point
 * of the hole is that this book is not on the shelf yet. The cat peeps out of
 * the hole to say where, and the line under the plank says what, which is what
 * the drawing has done since the gallery had a placing screen at all.
 */
export function ShelfStrip({ strip, inHand, onOpen }: Props) {
  // Already on the shelf: it is drawn in the row, and there is no gap to open
  // and nothing left to carry over. Otherwise the row breaks at the gap.
  const placed = strip.placedIndex !== null
  const at = placed ? strip.placedIndex! : strip.gapIndex
  const left = at
  const right = strip.books.length - at - (placed ? 1 : 0)

  return (
    <Shelf
      // A different shelf is a different row, and the effect that brings the
      // interesting part of it into view has to run again for it.
      key={strip.label}
      label={strip.label}
      note={`${left} to the left · ${right} to the right`}
      items={placing(strip, onOpen)}
      // Nothing is in your hand once the book is standing in the row, and this
      // same component draws that moment at the end of the journey.
      inHand={placed ? undefined : inHand || 'this book'}
    />
  )
}
