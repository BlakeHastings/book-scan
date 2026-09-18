import type { PlacementResponse, PlacementStrip } from '../lib/api'
import { Instruction } from '../design/Card'
import { Shelf } from '../design/Shelf'
import { placing } from '../lib/bookLook'
import { PlacementCard } from './PlacementCard'

/** Falls back to `PlacementCard` when a placement arrives without a strip, which is what an empty range or an older server gives. */
export function PlacementView({
  placement, pending, instruction = true, inHand, onOpen,
}: {
  placement: PlacementResponse | null
  pending: boolean
  /** The shelving step wants both drawing and words; the detail view does not, since there the drawing is context rather than an instruction to act on. */
  instruction?: boolean
  /** Falls back to the filing name, the only name a placement carries on its own. */
  inHand?: string
  /** The detail view passes this so its neighbours are reachable; the shelving step does not, since walking off to a different record mid-placement would lose the one in hand. */
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
 * Only the arithmetic a placement has and a shelf does not: which side of the
 * gap each book is on, and what the book in hand is called. `Shelf` draws the
 * rest. The held book is deliberately not drawn as a spine in the gap: the
 * whole point of the gap is that it is not on the shelf yet.
 */
export function ShelfStrip({ strip, inHand, onOpen }: Props) {
  // Once placed, there is no gap left to open; `gapIndex` and `placedIndex`
  // are mutually exclusive.
  const placed = strip.placedIndex !== null
  const at = placed ? strip.placedIndex! : strip.gapIndex
  const left = at
  const right = strip.books.length - at - (placed ? 1 : 0)

  return (
    <Shelf
      // Keyed by label so a different shelf remounts and its scroll-into-view effect runs again.
      key={strip.label}
      label={strip.label}
      note={`${left} to the left · ${right} to the right`}
      items={placing(strip, onOpen)}
      // Nothing is in hand once the book stands in the row; this same
      // component also draws that end-of-journey moment.
      inHand={placed ? undefined : inHand || 'this book'}
    />
  )
}
