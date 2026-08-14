/**
 * The whole of the outstanding work, as the trips it is made of.
 *
 * ## The unit of work is a trip
 *
 * Five rows for fifty-three books, because that is what somebody does: stand at
 * one area, take everything off it that is going to one other area, walk once,
 * put them down. A flat list of fifty-three books is a list of fifty-three
 * walks, and it is the thing #291 says not to hand anybody.
 *
 * No card explaining the list, either. Each row names both ends and the count,
 * which is the whole of what a sentence over it could have said.
 *
 * ## Coming back on Sunday is the normal case
 *
 * Nothing is stored per session, so there is nothing to resume: the list is what
 * is left, and every book carried has taken itself off it. What the screen owes
 * is that coming back does not read as starting again, so when anything has been
 * carried the screen leads with that, the trips say how much of them is done,
 * and the button says carry on rather than start.
 *
 * ## One book, and none
 *
 * A list of one trip so it can be tapped is a tap for nothing, so a single book
 * skips this screen entirely and lands on the area it comes off. That is
 * `CarryScreen`'s decision rather than this file's, and it is why there is no
 * one-book state drawn here.
 *
 * Nothing to carry is the state this whole flow is trying to reach, and it says
 * so rather than drawing an empty list.
 */

import { Card, Nothing } from '../design/Card'
import { Cat } from '../design/Cat'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Trip, Trips } from '../design/Carrying'
import { WfScreen } from './WfScreen'
import { plural, said, saidBooks, skipSaid, stretchOf, whenSaid, words } from '../lib/carryWords'
import type { CarryTrip, CarryWork } from '../lib/api'

interface Props {
  /** Null while the first request is in flight. Nothing is drawn from a guess. */
  work: CarryWork | null
  onTrip: (trip: CarryTrip) => void
  onChanged: () => void
  onHome: () => void
  onLibrary: () => void
  onQueue: () => void
  onScan: () => void
}

/** What one row says under the two labels and the count. */
function noteOn(trip: CarryTrip): string {
  if (trip.carried > 0) {
    const all = trip.carried + trip.books.length
    return `${said(trip.carried)} of the ${words(all)} are on ${trip.to} already`
  }
  return stretchOf(trip.books.map((book) => book.authorFiling))
}

export function CarryPane({
  work, onTrip, onChanged, onHome, onLibrary, onQueue, onScan,
}: Props) {
  const tabs: Record<TabName, () => void> = {
    home: onHome,
    library: () => {},
    scan: onScan,
    queue: onQueue,
  }

  if (!work) {
    return (
      <WfScreen
        tab="library"
        tabs={tabs}
        top={<TopBar title="Books to carry" onBack={onHome} />}
      />
    )
  }

  if (work.moving === 0) {
    return (
      <WfScreen
        tab="library"
        tabs={tabs}
        top={<TopBar title="Books to carry" sub="Nothing to carry" onBack={onHome} />}
      >
        <Nothing said="Every book is where the rules want it.">
          <p>Nothing to fetch, nothing to put back.</p>
        </Nothing>

        <Button tone="quiet" block onPress={onLibrary}>
          See your furniture
        </Button>
      </WfScreen>
    )
  }

  const first = work.trips[0]!
  const resumed = work.carried.books > 0

  return (
    <WfScreen
      tab="library"
      tabs={tabs}
      top={
        <TopBar
          title="Books to carry"
          sub={`${plural(work.moving, 'book')}, ${words(work.trips.length)} ${
            work.trips.length === 1 ? 'trip' : 'trips'}`}
          onBack={onHome}
        />
      }
    >
      {/* What was already done is said first, so a resumed list reads as
          carrying on. It is a fact about the ledger rather than about a session:
          books put down on the most recent day anybody put one down. */}
      {resumed && (
        <Card weight="sunk">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Cat pose="sitting" size={52} />
            <p style={{ margin: 0, fontFamily: 'var(--face-book)', fontSize: 17 }}>
              You carried {words(work.carried.books)} {whenSaid(work.carried.when)}.
            </p>
          </div>
        </Card>
      )}

      <Trips label="Books to carry">
        {work.trips.map((trip) => (
          <Trip
            key={`${trip.fromAreaId}:${trip.toAreaId}`}
            from={trip.from}
            to={trip.to}
            count={trip.books.length}
            note={noteOn(trip)}
            onPress={() => onTrip(trip)}
          />
        ))}
      </Trips>

      <Button tone="primary" block onPress={() => onTrip(first)}>
        {resumed ? `Carry on at ${first.from}` : `Start at ${first.from}`}
      </Button>

      {/* Only once there is a "while you were away" to have been away from.
          Applying a plan is itself a change, and offering to explain it to
          somebody who has just made it and is looking at the result is noise;
          the case this is for is a list somebody was part way through. Books
          they carried and have to carry again are named whether or not they
          carried anything today, because that is the one thing nobody may find
          out one book at a time at a shelf. */}
      {work.changed && (resumed || work.changed.again.length > 0) && (
        <Button tone="quiet" block onPress={onChanged}>
          What changed while you were away
        </Button>
      )}

      {work.skipped.length > 0 && (
        <Card
          weight="quiet"
          kind="Not on this list"
          title={saidBooks(work.skipped.reduce((all, one) => all + one.books, 0))}
        >
          <p>{skipSaid(work.skipped)}</p>
        </Card>
      )}
    </WfScreen>
  )
}

