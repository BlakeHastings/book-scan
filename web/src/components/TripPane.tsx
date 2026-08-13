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
import { Shelf, type Cloth, type ShelfItem } from '../design/Shelf'
import { List, Row } from '../design/List'
import { WfScreen } from './WfScreen'
import { plural, said, saidBooks, surnameOf, words } from '../lib/carryWords'
import type { StandingBook, TripAtAnArea } from '../lib/api'

interface Props {
  /** Null while the area is being read. Nothing is drawn from a guess. */
  trip: TripAtAnArea | null
  /** True when this is the whole of the outstanding work. */
  only: boolean
  onTake: (books: StandingBook[]) => void
  onBack: () => void
  onHome: () => void
  onQueue: () => void
  onScan: () => void
}

/**
 * The bindings a placeholder spine is drawn in, picked off the book's own id so
 * a book is the same colour every time it is drawn. The same stand-in
 * `HomePane` uses, and for the same reason: the design system has nowhere to put
 * a photograph on a spine yet.
 */
const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']

const clothFor = (id: number): Cloth => CLOTHS[Math.abs(id) % CLOTHS.length]!

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
    // Zero is "the catalogue never learned", which the drawing sets at the
    // median rather than at a sliver. See `spineWidth`.
    pages: book.pages || undefined,
    here: mark && book.going,
  }))
}

/** Why the books that are not going are not going, said as one sentence. */
function stayingSaid(staying: readonly StandingBook[]): string {
  const pinned = staying.filter((book) => book.staying === 'pinned').length
  const elsewhere = staying.filter((book) => book.staying === 'elsewhere').length
  const settled = staying.length - pinned - elsewhere

  return [
    pinned > 0 ? `${said(pinned)} you pinned.` : '',
    elsewhere > 0 ? `${said(elsewhere)} going somewhere else.` : '',
    settled > 0 ? `${said(settled)} already where the rules want ${settled === 1 ? 'it' : 'them'}.` : '',
  ].filter(Boolean).join(' ')
}

export function TripPane({ trip, only, onTake, onBack, onHome, onQueue, onScan }: Props) {
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

      <Button tone="primary" block onPress={() => onTake(going)}>
        {one ? 'I have it' : `I have all ${words(going.length)}`}
      </Button>
      <Button tone="quiet" block onPress={onBack}>
        {only ? 'Not now' : 'Do a different one'}
      </Button>
    </WfScreen>
  )
}
