/** Nothing here closes a session: everything carried is already on the shelves and written down, so stopping is just stopping. */

import { Card, Confirmation } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Shelf, type ShelfItem } from '../design/Shelf'
import { coverThumbUrl } from './PlacementCard'
import { WfScreen } from './WfScreen'
import { clothFor } from '../lib/bookLook'
import { plural, saidBooks, surnameOf, words } from '../lib/carryWords'
import type { CarryTrip, CarryWork, StandingBook } from '../lib/api'

interface Props {
  /** How many books were just put down, and where. */
  placed: number
  to: string
  /** The area as it now stands. Null while it is being read. */
  board: StandingBook[] | null
  /** What is left, so the way on can name it. Null while it is being read. */
  work: CarryWork | null
  onTrip: (trip: CarryTrip) => void
  onHome: () => void
  onQueue: () => void
  onScan: () => void
}

/** Each book is drawn by its own photograph over the cloth it is bound in, the same as every other board; one with no photograph keeps its cloth and name down the spine, as in the library. */
function boardOf(books: readonly StandingBook[]): ShelfItem[] {
  return books.map((book) => ({
    kind: 'spine' as const,
    text: surnameOf(book.authorFiling) || book.title,
    cloth: clothFor(book.id),
    photo: coverThumbUrl(book.spine, 160),
    pages: book.pages || undefined,
  }))
}

export function CarriedPane({
  placed, to, board, work, onTrip, onHome, onQueue, onScan,
}: Props) {
  const tabs: Record<TabName, () => void> = {
    home: onHome,
    library: onHome,
    scan: onScan,
    queue: onQueue,
  }

  const next = work?.trips[0]

  return (
    <WfScreen tab="library" tabs={tabs} top={<TopBar title="Carried" />}>
      <Confirmation said={`${saidBooks(placed)} ${placed === 1 ? 'is' : 'are'} on ${to}.`} />

      {board && (
        <div className="wf-bleed">
          <Shelf label={to} note={plural(board.length, 'book')} items={boardOf(board)} />
        </div>
      )}

      {next ? (
        <Button tone="primary" block onPress={() => onTrip(next)}>
          Next: {words(next.books.length)} book{next.books.length === 1 ? '' : 's'} off{' '}
          {next.from}
        </Button>
      ) : (
        <Button tone="primary" block onPress={onHome}>
          That is everything
        </Button>
      )}

      <Button tone="quiet" block onPress={onHome}>
        {next ? 'That is enough for today' : 'Back to the start'}
      </Button>

      {work && work.moving > 0 && (
        <Card
          weight="quiet"
          kind="Still to carry"
          title={`${saidBooks(work.moving)}, ${words(work.trips.length)} ${
            work.trips.length === 1 ? 'trip' : 'trips'}`}
        />
      )}
    </WfScreen>
  )
}
