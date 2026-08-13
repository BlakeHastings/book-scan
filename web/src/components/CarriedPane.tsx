/**
 * The end of one trip, which is the same shape as the end of shelving a book.
 *
 * The answer is drawn rather than said twice: the area is there with the books
 * on it, and the sentence over it is the one thing the drawing cannot say, which
 * is how many of them were just carried.
 *
 * ## The way on is the next trip, by name
 *
 * The person is holding nothing and standing next to the area they have just
 * filled, so the useful offer is the next armful and where it comes off. The way
 * out says what it means: there is no session to close, so stopping is stopping,
 * and everything carried is already on the shelves and written down.
 */

import { Card, Confirmation } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Shelf, type Cloth, type ShelfItem } from '../design/Shelf'
import { WfScreen } from './WfScreen'
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

const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']

const clothFor = (id: number): Cloth => CLOTHS[Math.abs(id) % CLOTHS.length]!

function boardOf(books: readonly StandingBook[]): ShelfItem[] {
  return books.map((book) => ({
    kind: 'spine' as const,
    text: surnameOf(book.authorFiling) || book.title,
    cloth: clothFor(book.id),
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
