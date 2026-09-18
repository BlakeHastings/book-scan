import { Card, Nothing } from '../design/Card'
import { Cat } from '../design/Cat'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Trip, Trips } from '../design/Carrying'
import { Sure } from '../design/Sure'
import { WfScreen } from './WfScreen'
import {
  leftBooks, leftSaid, plural, said, saidBooks, sharedSaid, skipSaid, stretchOf,
  whenSaid, words,
} from '../lib/carryWords'
import type { CarryTrip, CarryWork } from '../lib/api'

interface Props {
  /** Null while the first request is in flight. Nothing is drawn from a guess. */
  work: CarryWork | null
  onTrip: (trip: CarryTrip) => void
  onChanged: () => void
  /** A prop rather than local state, like `AreaPane`: this component holds no state so every state can be rendered directly in a test. */
  asking?: boolean
  onAsk: () => void
  onKeep: () => void
  /** Leave every outstanding book where it stands. Asked about first. */
  onLeave: () => void
  /** Put the work somebody left back on the list. */
  onRestore: () => void
  /** A leave or a put-back is in flight, so neither can be sent twice. */
  busy?: boolean
  onHome: () => void
  onLibrary: () => void
  /** Kept separate from `onLibrary`: a caller wiring both to the same screen previously sent "See your fixtures" to the library instead. */
  onFurniture: () => void
  onQueue: () => void
  onScan: () => void
}

/** What one row says under the two labels and the count. */
function noteOn(trip: CarryTrip): string {
  // Checked first: a row whose two ends read the same cannot be acted on, so
  // the authors stretch beneath it must not imply otherwise.
  if (trip.sharedNumber !== null) return sharedSaid(trip.from, trip.sharedNumber)
  if (trip.carried > 0) {
    const all = trip.carried + trip.books.length
    return `${said(trip.carried)} of the ${words(all)} are on ${trip.to} already`
  }
  return stretchOf(trip.books.map((book) => book.authorFiling))
}

/** Drawn on both the populated and empty states: an empty list that said nothing about this decision would read as the rules having changed their mind. */
function leftBehind(work: CarryWork, onRestore: () => void, busy: boolean) {
  if (work.setAside.length === 0) return null

  return (
    <>
      <Card
        weight="quiet"
        kind="Left where they are"
        title={saidBooks(leftBooks(work.setAside))}
      >
        {work.setAside.map((group) => (
          <p key={`${group.fromAreaId}:${group.toAreaId}`}>{leftSaid(group)}</p>
        ))}
      </Card>

      <Button tone="quiet" block off={busy} onPress={onRestore}>
        Put them back on the list
      </Button>
    </>
  )
}

export function CarryPane({
  work, onTrip, onChanged, asking = false, onAsk, onKeep, onLeave, onRestore, busy = false,
  onHome, onLibrary, onFurniture, onQueue, onScan,
}: Props) {
  const tabs: Record<TabName, () => void> = {
    home: onHome,
    library: onLibrary,
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
    const left = leftBooks(work.setAside)
    return (
      <WfScreen
        tab="library"
        tabs={tabs}
        top={<TopBar title="Books to carry" sub="Nothing to carry" onBack={onHome} />}
      >
        {/* The two empty messages mean different things: one says the rules agree, the other that somebody has already answered them. */}
        <Nothing
          said={left > 0
            ? 'Nothing is waiting to be carried.'
            : 'Every book is where the rules want it.'}
        >
          <p>Nothing to fetch, nothing to put back.</p>
        </Nothing>

        {leftBehind(work, onRestore, busy)}

        <Button tone="quiet" block onPress={onFurniture}>
          See your fixtures
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
      over={asking ? (
        <Sure
          title={`${saidBooks(work.moving)} stay where they are`}
          said={
            <>
              Nothing is moved and nothing is carried. The app stops asking for
              them, and you can put this work back on the list afterwards. The
              rules that want them elsewhere are unchanged, so it is worth
              changing those too if you never want to be asked again.
            </>
          }
          act={busy ? 'Leaving them...' : 'Leave them where they are'}
          busy={busy}
          onAct={onLeave}
          onKeep={onKeep}
        />
      ) : undefined}
    >
      {/* A fact about the ledger, not the session: `work.carried` is whatever was put down most recently, not what happened in this sitting. */}
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

      {/* Shown only when resumed or something changed again, not right after applying a plan, since explaining a change to whoever just made it would be noise. */}
      {work.changed && (resumed || work.changed.again.length > 0) && (
        <Button tone="quiet" block onPress={onChanged}>
          What changed while you were away
        </Button>
      )}

      <Button tone="quiet" block off={busy} onPress={onAsk}>
        Leave them where they are
      </Button>

      {work.skipped.length > 0 && (
        <Card
          weight="quiet"
          kind="Not on this list"
          title={saidBooks(work.skipped.reduce((all, one) => all + one.books, 0))}
        >
          <p>{skipSaid(work.skipped)}</p>
        </Card>
      )}

      {leftBehind(work, onRestore, busy)}
    </WfScreen>
  )
}
