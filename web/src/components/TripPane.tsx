/**
 * The ones staying are drawn rather than hidden: a screen that showed only the
 * ones to take would leave somebody counting to see what was left out. Every
 * book is drawn by its photograph, which here is not decoration, since
 * somebody is matching a phone against a shelf. Pressing the button writes
 * nothing: taking a book off one area is not recorded until it is carried, so
 * walking away here costs nothing.
 */

import { Card, Instruction, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { Shelf, type ShelfItem } from '../design/Shelf'
import { List, Row } from '../design/List'
import { Sure } from '../design/Sure'
import { coverThumbUrl } from './PlacementCard'
import { WfScreen } from './WfScreen'
import { clothFor } from '../lib/bookLook'
import { plural, said, saidBooks, sharedSaid, surnameOf, words } from '../lib/carryWords'
import type { StandingBook, TripAtAnArea } from '../lib/api'

interface Props {
  /** Null while the area is being read. Nothing is drawn from a guess. */
  trip: TripAtAnArea | null
  /** True when this is the whole of the outstanding work. */
  only: boolean
  onTake: (books: StandingBook[]) => void
  /** A prop rather than local state, like `AreaPane`: this pane holds no state. */
  asking?: boolean
  onAsk: () => void
  onKeep: () => void
  /** Leave this trip's books where they stand. Asked about first. */
  onLeave: () => void
  /** The answer is being carried out, so it cannot be sent twice. */
  busy?: boolean
  onBack: () => void
  onHome: () => void
  onQueue: () => void
  onScan: () => void
}

/**
 * Marks stay where the books actually stand rather than being grouped
 * together, since the shelf drawn is a real shelf. Nothing is marked when
 * everything is going: marking every book would answer nothing.
 */
function boardOf(books: readonly StandingBook[], mark: boolean): ShelfItem[] {
  return books.map((book) => ({
    kind: 'spine' as const,
    text: surnameOf(book.authorFiling) || book.title,
    cloth: clothFor(book.id),
    // Empty for a book nobody photographed; the cloth beneath is the same
    // pair the library uses, so it is the same book on both screens.
    photo: coverThumbUrl(book.spine, 160),
    // 0 means the catalogue never learned the page count; the drawing sets
    // that width at the median rather than a sliver. See `spineWidth`.
    pages: book.pages || undefined,
    here: mark && book.going,
  }))
}

/** "left" gets its own clause rather than joining "settled": saying a turned-down move is "already where the rules want it" would have the app agreeing with a decision it did not make. */
function stayingSaid(staying: readonly StandingBook[]): string {
  const pinned = staying.filter((book) => book.staying === 'pinned').length
  const elsewhere = staying.filter((book) => book.staying === 'elsewhere').length
  const left = staying.filter((book) => book.staying === 'left').length
  const settled = staying.length - pinned - elsewhere - left

  return [
    pinned > 0 ? `${said(pinned)} you pinned.` : '',
    elsewhere > 0 ? `${said(elsewhere)} going somewhere else.` : '',
    left > 0 ? `${said(left)} you left ${left === 1 ? 'where it is' : 'where they are'}.` : '',
    settled > 0 ? `${said(settled)} already where the rules want ${settled === 1 ? 'it' : 'them'}.` : '',
  ].filter(Boolean).join(' ')
}

export function TripPane({
  trip, only, onTake, asking = false, onAsk, onKeep, onLeave, busy = false,
  onBack, onHome, onQueue, onScan,
}: Props) {
  const tabs: Record<TabName, () => void> = {
    home: onHome,
    library: onBack,
    scan: onScan,
    queue: onQueue,
  }

  if (!trip) {
    return (
      <WfScreen tab="library" tabs={tabs} top={<TopBar title="One trip" onBack={onBack} />} />
    )
  }

  const going = trip.books.filter((book) => book.going)
  const staying = trip.books.filter((book) => !book.going)
  const one = going.length === 1

  return (
    <WfScreen
      tab="library"
      tabs={tabs}
      top={
        <TopBar
          title={only && one ? 'One book to carry' : trip.from}
          sub={only && one ? undefined : staying.length === 0
            // Avoids "two of the two", which reads as arithmetic rather than an answer.
            ? `Everything here goes to ${trip.to}`
            : `${words(going.length)} of the ${
              words(trip.books.length)} books here go to ${trip.to}`}
          onBack={onBack}
        />
      }
      over={asking ? (
        <Sure
          title={going.length === 1
            ? `${going[0]?.title ?? 'It'} stays on ${trip.from}`
            : `${said(going.length)} books stay on ${trip.from}`}
          said={
            <>
              Nothing is moved and nothing is carried. This trip leaves the list
              and you can put it back afterwards. The rules that want these on
              {' '}{trip.to} are unchanged.
            </>
          }
          act={busy ? 'Leaving them...' : 'Leave them where they are'}
          busy={busy}
          onAct={onLeave}
          onKeep={onKeep}
        />
      ) : undefined}
    >
      {/* Must appear above the instruction: otherwise the instruction alone would read as "take these off 4A and put them on 4A", accomplishing nothing. */}
      {trip.sharedNumber !== null && (
        <Card kind="Two pieces stand here">
          <Said>{sharedSaid(trip.from, trip.sharedNumber)}</Said>
        </Card>
      )}

      <Instruction>
        {one
          ? <>Take <em>{going[0]?.title}</em> off {trip.from}.</>
          : `Take these ${words(going.length)} off ${trip.from}.`}
      </Instruction>

      <div className="wf-bleed">
        <Shelf
          label={trip.from}
          note={staying.length === 0
            ? plural(trip.books.length, 'book')
            : `${plural(trip.books.length, 'book')}, ${words(going.length)} marked`}
          items={boardOf(trip.books, staying.length > 0)}
        />
      </div>

      {one ? (
        <Said>It goes on {trip.to}.</Said>
      ) : (
        <List label={`The ${words(going.length)} to take`}>
          {going.map((book) => (
            <Row
              key={book.id}
              title={book.title}
              sub={book.authorFiling}
              cloth={clothFor(book.id)}
              photo={coverThumbUrl(book.cover, 160)}
              onward={false}
            />
          ))}
        </List>
      )}

      {staying.length > 0 && (
        <Card
          weight="quiet"
          kind={`Staying on ${trip.from}`}
          title={saidBooks(staying.length)}
        >
          <p>{stayingSaid(staying)}</p>
        </Card>
      )}

      <Button tone="primary" block off={busy} onPress={() => onTake(going)}>
        {one ? 'I have it' : `I have all ${words(going.length)}`}
      </Button>
      <Button tone="quiet" block off={busy} onPress={onBack}>
        {only ? 'Not now' : 'Do a different one'}
      </Button>

      {/* Distinct from "Not now" above it: that returns to the list with this trip still on it, this one removes the trip from the list. */}
      <Button tone="quiet" block off={busy} onPress={onAsk}>
        {one ? 'Leave it where it is' : 'Leave them where they are'}
      </Button>
    </WfScreen>
  )
}
