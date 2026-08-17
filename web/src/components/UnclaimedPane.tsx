/**
 * The books no rule claims, which is the question the app could not answer.
 *
 * #341, built against the drawing at `#/design/unclaimed` and `#/design/
 * unclaimednone`. The read behind it has existed since #346 and nothing in the
 * app reached it: `GET /api/placement/unclaimed` was a route with no caller and
 * four wireframes with no screens.
 *
 * ## Why any of this is a screen at all
 *
 * Since #304 a book can honestly have no genre tag, because a genre is written
 * only when a catalogue states one. Such a book matches no rule, so it appears
 * in no range listing, in neither misfile review, in none of the first screen's
 * five counts and on no area's claimed-by-nothing card, because that card reads
 * the area a book is filed into and this book is filed into none. It stands
 * exactly where somebody left it and no plan will ever move it. The books most
 * in need of a person were the ones the app said least about.
 *
 * ## Two blocks, because there are two states and two ways out
 *
 * A book carrying **no tag at all** is the state #304 made real: nothing was
 * ever said about it, so there is nothing for any rule to ask about, and the
 * only way out is a person saying what it is.
 *
 * A book carrying **a tag no rule asks for** is a different thing landing in the
 * same place. Somebody has already said something; what is missing is a rule.
 * Telling nine crime novels they are also Fiction is the wrong repair when the
 * household reads crime and the real answer is one rule about Crime. So that
 * block opens the screen that explains one book rather than the panel that adds
 * a word to it.
 *
 * One list of twelve identical rows would have hidden that and offered one
 * remedy for two problems.
 *
 * ## Saying what a book is happens on its own screen
 *
 * A row opens `SayingPane`, which is the drawing at `#/design/saying` and is
 * built out of #377's own two pieces: the genre answers as words you tap, and
 * the naming panel for anything else. Nothing on this screen writes anything.
 *
 * **And nothing writes a tag by itself anywhere in this flow.** Answering "which
 * books does no rule claim" by filing them all as non-fiction is precisely what
 * #304 stopped doing on the owner's explicit instruction, and it is the thing a
 * helpful edit to either file would reintroduce.
 *
 * ## Saying what a book is does not move it
 *
 * Only a person moving a book changes where a book is, and this screen sits
 * beside a carry flow that exists because of exactly that. So the quiet card at
 * the foot says so once, at the start, rather than on every book: somebody
 * settling nine in a row should meet that sentence once and not nine times.
 */

import { Card, Instruction, Nothing, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { List, Row } from '../design/List'
import type { Cloth } from '../design/Shelf'
import type { UnclaimedBook } from '../lib/api'
import { grouped, said, saidBooks, words } from '../lib/carryWords'
import { RoomFrame, Trouble } from './RoomFrame'

/**
 * What the last book somebody settled did, which is the point of coming back.
 *
 * Both answers have to read as something having happened. A book that is gone
 * from the list was taken by a rule; a book still on it, now carrying a word
 * nothing asks for, has been recorded and not filed, and without a sentence
 * that reads exactly like the press having failed.
 */
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

/**
 * The one line the screen leads with, counted.
 *
 * One book is its own sentence rather than "these one", which is the state a
 * collection reaches on the way to none and the one a drawing of twelve never
 * shows.
 */
function leadOn(total: number): string {
  return total === 1
    ? 'No rule asks for this book, so nothing will ever move it.'
    : `No rule asks for these ${words(total)}, so nothing will ever move them.`
}

/**
 * What the last thing somebody said did, or nothing where they said nothing.
 *
 * Walking in, looking and walking out again is the ordinary thing to do on this
 * screen, and a line reporting it would be the app narrating a person's own
 * inaction back at them.
 */
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
      title="Nothing files these"
      sub={books === null ? undefined : (total === 0 ? 'Every book is claimed' : saidBooks(total))}
      onBack={onBack}
    />
  )

  /* Nothing has come back yet. An empty list drawn from a request in flight
     would say "every book is claimed" about somebody's collection for as long
     as the read takes, which is the one sentence this screen must never say
     wrongly. */
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

        {/* The one thing that survives the list emptying. Somebody who has just
            settled the last of them is standing here, and a screen that went
            blank would have thrown away the answer they were working for. */}
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

  const untagged = books.filter((book) => book.why === 'untagged')
  const unmatched = books.filter((book) => book.why === 'unmatched')
  const first = untagged[0]

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <Instruction>{leadOn(total)}</Instruction>

      {answered && <Said>{answered}</Said>}

      {/*
        The way on hangs off this card rather than off the foot of the screen,
        which is where the drawing put it until it was looked at: a dozen rows
        put a primary button a long way below the sentence explaining it, and
        the two blocks do not share one way out anyway. Each block carries its
        own, which is the point of their being two.
      */}
      {untagged.length > 0 && (
        <Card
          /* Counted, because a block of one is what the last of them looks
             like and "nobody has said what they are" over "One book" is the
             screen not reading its own count. */
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
                /* Where it stands, because that is the fact that lets somebody
                   walk to it, and blank where nobody has ever said. */
                place={book.standing?.label}
                onPress={() => onSay(book)}
              />
            ))}
          </List>
        </Card>
      )}

      {/*
        The tag rather than the place on these rows, and it is the one difference
        between the two lists. What somebody is deciding here is whether Crime
        should have a rule, and that question is about the tag; where the book
        happens to be standing does not help them answer it.
      */}
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

      {/* Only when the page is short of the count above it, which is a room
          whose rules have nearly all been switched off. Said rather than
          silently drawn, because a screen listing eighty of five hundred under a
          heading that says five hundred is a screen lying about how much work
          is left. */}
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

      {/* Said once, here, rather than on the panel that asks: somebody who
          settles nine books in a row should meet this sentence at the start and
          not nine times. */}
      <Card weight="quiet" kind="What it does not do" title="Nothing here moves a book">
        <p>
          Saying what a book is only gives a rule something to ask for. If that
          rule wants it somewhere else, it joins your carry list.
        </p>
      </Card>
    </RoomFrame>
  )
}
