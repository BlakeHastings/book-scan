/**
 * One trip, read at the area the books come off.
 *
 * At this moment somebody is looking at eleven spines and needs to know which
 * eight. So the area is drawn whole, the ones to take are marked on the board
 * and named underneath, and **the ones staying are drawn rather than hidden**: a
 * screen that showed only the eight would have somebody counting to eleven and
 * wondering which three it had left out.
 *
 * The reason each of them is staying is on the card under the board, because a
 * count with no reason is not an answer to that question.
 *
 * **Every book here is drawn by its photograph**, which on this screen is not
 * decoration: a person is holding the phone up against a shelf, and the picture
 * is what they match. It is the same pair the library draws a book with, the
 * photograph over the dyed cloth, so a book nobody has photographed is still a
 * bound book on the board rather than a gap in the row.
 *
 * ## Pressing the button writes nothing
 *
 * It is the only step in this flow that does not write, and it is a navigation
 * rather than a record: the books are not anywhere yet. Nothing is recorded
 * between taking a book off one area and putting it on another, which is why
 * there is no step to unwind and why walking away here costs nothing.
 *
 * ## One book skips the list, and lands here
 *
 * The grouping earns nothing for a single book and a list of one trip is a tap
 * for nothing, so a one-book job comes straight to this screen. Same journey,
 * two screens shorter, and the only thing that differs is what the bar says and
 * where the way back goes.
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
import { plural, said, saidBooks, surnameOf, words } from '../lib/carryWords'
import type { StandingBook, TripAtAnArea } from '../lib/api'

interface Props {
  /** Null while the area is being read. Nothing is drawn from a guess. */
  trip: TripAtAnArea | null
  /** True when this is the whole of the outstanding work. */
  only: boolean
  onTake: (books: StandingBook[]) => void
  /**
   * The question about leaving this trip is on screen.
   *
   * A prop rather than state in here, the way `AreaPane` takes the question
   * about removing an area: this pane holds nothing.
   */
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
 * The area as it stands, with the books to take marked on it.
 *
 * Marked where they are rather than gathered into a block at one end: the
 * drawing is the shelf, and moving a book in it to make the marks tidy would be
 * a picture of a shelf nobody has.
 *
 * **Nothing is marked when everything is going**, which was found by looking at
 * it: the mark answers "which of these", and a cat on every book on the board
 * answers nothing while looking like a row of cats. The instruction above
 * already says to take them all.
 */
function boardOf(books: readonly StandingBook[], mark: boolean): ShelfItem[] {
  return books.map((book) => ({
    kind: 'spine' as const,
    text: surnameOf(book.authorFiling) || book.title,
    cloth: clothFor(book.id),
    /*
     * The photograph of the spine, which is what somebody is matching the phone
     * against. Empty for a book nobody has photographed, and the cloth under it
     * is what that book is drawn in: the same pair the library draws every
     * board with, so a book is the same book on both screens.
     */
    photo: coverThumbUrl(book.spine, 160),
    // Zero is "the catalogue never learned", which the drawing sets at the
    // median rather than at a sliver. See `spineWidth`.
    pages: book.pages || undefined,
    here: mark && book.going,
  }))
}

/**
 * Why the books that are not going are not going, said as one sentence.
 *
 * **A book somebody left where it is gets its own clause rather than joining the
 * settled ones.** Settled means the rules want it here, and saying that about a
 * book whose move was turned down would have the app quietly agreeing with
 * itself about a decision it did not make.
 */
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
            /* Nothing stays, so there is no "which of these" to answer and the
               sentence that answers it reads as arithmetic: "two of the two". */
            ? `Everything here goes to ${trip.to}`
            : `${words(going.length)} of the ${
              words(trip.books.length)} books here go to ${trip.to}`}
          onBack={onBack}
        />
      }
      /* Over the trip, with the area still drawn underneath: what is being
         asked about is the books somebody is looking at. */
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

      {/* Last, and quiet, because it is the answer somebody gives when this walk
          is not going to happen at all. "Not now" above it comes back to the
          list with the trip still on it; this one takes the trip off. */}
      <Button tone="quiet" block off={busy} onPress={onAsk}>
        {one ? 'Leave it where it is' : 'Leave them where they are'}
      </Button>
    </WfScreen>
  )
}
