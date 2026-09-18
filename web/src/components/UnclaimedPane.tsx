import { Card, Instruction, Nothing, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { List, Row } from '../design/List'
import type { Cloth } from '../design/Shelf'
import type { UnclaimedBook } from '../lib/api'
import { grouped, said, saidBooks, words } from '../lib/carryWords'
import { RoomFrame, Trouble } from './RoomFrame'

/** `claimed` true means a rule took the book off the list; false with tags means it was recorded but no rule asks for it yet. */
export interface Settled {
  title: string
  /** Whether a rule claims it now. */
  claimed: boolean
  /** What it carries now, by the labels a person reads. */
  tags: string[]
}

interface Props {
  /** The page of them, or null before the first read has answered. */
  books: UnclaimedBook[] | null
  /** How many there are altogether, which the page may be short of. */
  total: number
  error: string
  /** What the last thing somebody said did, drawn until they say another. */
  settled: Settled | null
  tabs: Record<TabName, () => void>
  onBack: () => void
  /** Open the screen somebody says what one book is on. */
  onSay: (book: UnclaimedBook) => void
  /** Why one book is here, which is the screen that explains and offers. */
  onClaimed: (bookId: number) => void
  onFurniture: () => void
}

const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']
const clothFor = (id: number): Cloth => CLOTHS[Math.abs(id) % CLOTHS.length]!

function leadOn(total: number): string {
  return total === 1
    ? 'No rule asks for this book, so nothing will ever move it.'
    : `No rule asks for these ${words(total)}, so nothing will ever move them.`
}

/** Returns '' when nothing happened worth reporting, rather than narrating a no-op back at the person. */
function settledSaid(settled: Settled): string {
  if (settled.claimed) {
    return `${settled.title} is filed now, and a rule wants it. If that is `
      + 'somewhere else, it is on your carry list.'
  }
  if (settled.tags.length === 0) return ''
  return `${settled.title} is under ${settled.tags.join(' and ')}. `
    + 'No rule asks for that yet, so it is still here.'
}

export function UnclaimedPane({
  books, total, error, settled, tabs, onBack, onSay, onClaimed, onFurniture,
}: Props) {
  const answered = settled ? settledSaid(settled) : ''

  const top = (
    <TopBar
      title="Unfiled books"
      sub={books === null ? undefined : (total === 0 ? 'Every book is claimed' : saidBooks(total))}
      onBack={onBack}
    />
  )

  // Must stay distinct from an empty list: an empty list mid-request would
  // falsely say "every book is claimed" while the read is still in flight.
  if (books === null) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  if (total === 0) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />

        {/* Shown even here: somebody who just settled the last book would otherwise lose the confirmation they were waiting for. */}
        {answered && <Said>{answered}</Said>}

        <Nothing said="Every book has a rule that wants it.">
          <p>Nothing is waiting for you to say what it is.</p>
        </Nothing>

        <Button tone="quiet" block onPress={onFurniture}>
          See your fixtures
        </Button>
      </RoomFrame>
    )
  }

  // "untagged": nothing was ever said about the book, so no rule has anything
  // to ask about. "unmatched": something was said, but no rule asks for it.
  const untagged = books.filter((book) => book.why === 'untagged')
  const unmatched = books.filter((book) => book.why === 'unmatched')
  const first = untagged[0]

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <Instruction>{leadOn(total)}</Instruction>

      {answered && <Said>{answered}</Said>}

      {untagged.length > 0 && (
        <Card
          kind={untagged.length === 1
            ? 'Nobody has said what it is'
            : 'Nobody has said what they are'}
          title={saidBooks(untagged.length)}
          foot={first && (
            <Button tone="primary" block onPress={() => onSay(first)}>
              {untagged.length === 1
                ? `Say what ${first.title} is`
                : 'Say what the first one is'}
            </Button>
          )}
        >
          <p>
            No catalogue named a subject for {untagged.length === 1 ? 'it' : 'these'},
            so nothing was written down and there is nothing for a rule to ask
            about.
          </p>
          <List label="Books nobody has said anything about">
            {untagged.map((book) => (
              <Row
                key={book.id}
                title={book.title}
                sub={book.authorFiling}
                cloth={clothFor(book.id)}
                // Blank when the book has never stood anywhere to record.
                place={book.standing?.label}
                onPress={() => onSay(book)}
              />
            ))}
          </List>
        </Card>
      )}

      {/* Shows the tag rather than the place, unlike the untagged list above: deciding whether to add a rule is about the tag, not where the book happens to be standing. */}
      {unmatched.length > 0 && (
        <Card
          kind={unmatched.length === 1
            ? 'Nothing asks for what it carries'
            : 'Nothing asks for what they carry'}
          title={saidBooks(unmatched.length)}
        >
          <p>
            Somebody already said something about {unmatched.length === 1 ? 'this one' : 'these'}.
            What is missing is a rule that asks for it, and one rule can take
            several books at once. Open one to see what it carries.
          </p>
          <List label="Books carrying a tag no rule asks for">
            {unmatched.map((book) => (
              <Row
                key={book.id}
                title={book.title}
                sub={book.authorFiling}
                cloth={clothFor(book.id)}
                meta={book.tags[0]}
                onPress={() => onClaimed(book.id)}
              />
            ))}
          </List>
        </Card>
      )}

      {books.length < total && (
        <Card
          weight="quiet"
          kind="Not all of them at once"
          title={`${said(books.length)} of ${grouped(total)}`}
        >
          <p>
            The rest are here as soon as these are settled.
          </p>
        </Card>
      )}

      <Card weight="quiet" kind="What it does not do" title="Nothing here moves a book">
        <p>
          Saying what a book is only gives a rule something to ask for. If that
          rule wants it somewhere else, it joins your carry list.
        </p>
      </Card>
    </RoomFrame>
  )
}
