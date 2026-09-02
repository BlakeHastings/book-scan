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
 *
 * ## Not doing it is an answer, and it is on this screen
 *
 * Applying a plan writes what the rules want and moves nothing, and until #402
 * there was no way to say that answer is not one you are going to act on. So
 * forty-six of the owner's books sat here being asked for by an app he had
 * already decided against, and the only exits were to carry them or to look at
 * the list forever.
 *
 * **Leaving them where they are moves no book.** Every book stands where it
 * stands, the ones already carried keep the other end of the trip they were
 * carried on, and pinned books were never on this list to be reached. What goes
 * is the asking.
 *
 * It does not go quietly, either. The rule that wanted those books is still on
 * that place and only the owner can decide about it, so the pair, the count and
 * the rule's name stay on this screen under "Left where they are", with the way
 * to put the work back beside them. Silently forgetting a decision is the same
 * failure as silently reversing one.
 */

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
  /**
   * The question about leaving them is on screen.
   *
   * A prop rather than state in here, the way `AreaPane` takes the question
   * about removing an area: these panes hold nothing, which is what lets every
   * state of them be rendered and read in a test rather than driven.
   */
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
  onQueue: () => void
  onScan: () => void
}

/** What one row says under the two labels and the count. */
function noteOn(trip: CarryTrip): string {
  /* First, because a row whose two ends read the same is a row nobody can act
     on, and the stretch of authors under it would read as though they could. */
  if (trip.sharedNumber !== null) return sharedSaid(trip.from, trip.sharedNumber)
  if (trip.carried > 0) {
    const all = trip.carried + trip.books.length
    return `${said(trip.carried)} of the ${words(all)} are on ${trip.to} already`
  }
  return stretchOf(trip.books.map((book) => book.authorFiling))
}

/**
 * What somebody has already left where it is, and the way to put it back.
 *
 * Drawn on the list with work on it and on the list with none, because the state
 * this whole flow is trying to reach is one somebody can now reach by deciding
 * rather than by walking, and an empty list that said nothing about the decision
 * would read as the rules having changed their minds.
 */
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
  onHome, onLibrary, onQueue, onScan,
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
    const left = leftBooks(work.setAside)
    return (
      <WfScreen
        tab="library"
        tabs={tabs}
        top={<TopBar title="Books to carry" sub="Nothing to carry" onBack={onHome} />}
      >
        {/* Two different empty lists, and saying the wrong one is a lie about
            whose decision emptied it. Every book being where the rules want it
            is the rules agreeing; books left where they are is somebody having
            answered them, and the card underneath says what was answered. */}
        <Nothing
          said={left > 0
            ? 'Nothing is waiting to be carried.'
            : 'Every book is where the rules want it.'}
        >
          <p>Nothing to fetch, nothing to put back.</p>
        </Nothing>

        {leftBehind(work, onRestore, busy)}

        <Button tone="quiet" block onPress={onLibrary}>
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
      /* Over the list rather than beside it, and the list stays drawn
         underneath, because what is being asked about is the work on it. */
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

      {/* Quiet, and under the two that carry on with the work, because it is the
          answer somebody gives when the work is not going to happen. It asks
          before it does anything: one press deciding about every book on the
          list is a press whose size is not visible from the button. */}
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

