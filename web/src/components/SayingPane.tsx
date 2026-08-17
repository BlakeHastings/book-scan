/**
 * Somebody saying what one book is, which is the only way out of the state
 * where no rule claims it.
 *
 * Drawn at `#/design/saying` and built here against #341. It is the screen the
 * whole of that issue is for: the app now finds the books nothing files, and a
 * list of them that offered no way to settle one would be the same complaint at
 * a smaller size.
 *
 * ## It is the check-the-details screen's arrangement, deliberately
 *
 * #377 built saying what a book is, on the screen between a photograph and a
 * shelf, and it built it as two things: **the two genre answers as words you
 * tap**, and **a panel for everything else**. That split is not a layout, it is
 * the model. Fiction and non-fiction are the two answers a rule about a whole
 * bookcase asks, and they decide which side of the room a book crosses to;
 * anything else somebody says is a tag, which files nothing until a rule asks
 * for it.
 *
 * So this screen has the same two, calling the same panel and the same write.
 * A second way to add a tag would be two ways of saying what a book is, and the
 * one that got the next fix would be whichever screen somebody was looking at.
 *
 * ## Nothing is chosen when it opens, and nothing ever chooses itself
 *
 * This is where #304 is either kept or quietly broken by a helpful default.
 * That issue stopped the app writing a genre nobody stated, on the owner's
 * explicit instruction, and the way it comes back is one preselected answer on
 * this screen so that a button can be enabled. There is no such button: a tap
 * writes, the way it already does on the check-the-details screen, so there is
 * nothing here for a default to satisfy.
 *
 * ## And it says what the catalogue does hold
 *
 * The drawing gained that card by being looked at: it asked somebody what a
 * book is about while showing them nothing to answer from but a title in a bar.
 * The author, the publisher, the year, the length and where it stands are the
 * whole of what this app knows, and they are what somebody decides on.
 */

import { Card, Instruction, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { AddTag, Tag, Tags } from '../design/List'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { AppliedTag, BookRow, TagRow, UnclaimedBook } from '../lib/api'
import { labelOf } from '../lib/tagTree'
import { RoomFrame, Trouble } from './RoomFrame'
import { TagNaming } from './TagNaming'

interface Props {
  book: UnclaimedBook
  /** What the catalogue holds about it. Null until the read answers. */
  record: BookRow | null
  /** What a person has said, as pills that come off again when tapped. */
  tags: AppliedTag[]
  /** Every slug it carries, whoever said it. */
  carried: string[]
  vocabulary: TagRow[]
  busy: boolean
  error: string
  /** Whether the naming panel is open over this screen. */
  naming: boolean
  tabs: Record<TabName, () => void>
  onBack: () => void
  onSay: (tag: { slug: string; label: string }) => void
  onUnsay: (slug: string) => void
  onOpenNaming: () => void
  onCloseNaming: () => void
}

/**
 * The two answers a rule about a whole bookcase asks, by the words this
 * collection reads them as.
 *
 * The slug is the identity and the label is what a person reads, so the label
 * comes out of the vocabulary rather than being written here. The constant is
 * the fallback for a collection that has never had either, where the word is
 * the only thing there is to say.
 */
function genreAnswers(vocabulary: TagRow[]): { slug: string; label: string }[] {
  const say = (slug: string, fallback: string) => {
    const found = vocabulary.find((one) => one.slug === slug)
    return { slug, label: found ? labelOf(found) : fallback }
  }
  return [say(FICTION_SLUG, 'Fiction'), say(NON_FICTION_SLUG, 'Non-fiction')]
}

/** Everything the catalogue holds, as the one line it is worth being. */
function knownOf(record: BookRow | null): string {
  if (!record) return ''
  return [record.publisher, record.published, record.pages ? `${record.pages} pages` : '']
    .filter(Boolean)
    .join(' · ')
}

export function SayingPane({
  book, record, tags, carried, vocabulary, busy, error, naming,
  tabs, onBack, onSay, onUnsay, onOpenNaming, onCloseNaming,
}: Props) {
  const has = new Set(carried)

  /**
   * Whether somebody has said something **on this screen**.
   *
   * Not whether the book carries anything, which is the thing it was first
   * written as and which is wrong for the second of the two states: a book
   * arriving with Crime on it already carries something, and the screen greeted
   * it by reporting back an answer nobody had just given. What the book arrived
   * with is `book.tags`; anything past that is this visit.
   */
  const saidHere = carried.length > book.tags.length

  const over = naming ? (
    <TagNaming
      vocabulary={vocabulary}
      carried={carried}
      busy={busy}
      error={error}
      onPick={(tag) => onSay(tag)}
      onClose={onCloseNaming}
    />
  ) : undefined

  const known = knownOf(record)

  return (
    <RoomFrame
      top={<TopBar title="Say what it is" sub={book.title} onBack={onBack} />}
      tabs={tabs}
      over={over}
    >
      <Trouble said={naming ? '' : error} />

      {/*
        The line stops describing the state the book arrived in the moment
        somebody changes it. "Nothing knows what this book is" over a lit
        Fiction pill is the screen contradicting the answer it just took, and it
        was on screen until this was looked at. What replaces it is the next
        thing worth knowing, which this screen cannot answer itself: whether a
        rule took the book is `claim` on the server and the list is where it is
        asked.
      */}
      <Instruction>
        {saidHere
          ? 'What you say is on the book already. Going back says whether a rule took it.'
          : book.why === 'untagged'
            ? 'Nothing knows what this book is, so no rule can ask for it.'
            : 'No rule asks for what this book carries, so nothing files it.'}
      </Instruction>

      {/* Everything the catalogue does hold, because the question cannot be
          answered off a title in a bar. */}
      <Card weight="sunk" kind="All anybody knows about it" title={book.title}>
        <p>
          {book.authorFiling}
          {known && <> &middot; {known}</>}
        </p>
        {book.standing && <p>It stands on {book.standing.label}.</p>}
      </Card>

      {/*
        The two genre answers and the way to say anything else, which is the
        row the check-the-details screen already has. A tag that is on is lit
        and pressing it takes it off again, which is the "tap it again to unsay
        it" the tags screen has too.
      */}
      <Card kind="What you say goes on the book at once" title="What is it?">
        <Tags>
          {genreAnswers(vocabulary).map((answer) => (
            <Tag
              key={answer.slug}
              tone={has.has(answer.slug) ? 'on' : undefined}
              onPress={busy
                ? undefined
                : () => (has.has(answer.slug) ? onUnsay(answer.slug) : onSay(answer))}
            >
              {answer.label}
            </Tag>
          ))}
          {tags
            .filter((tag) => tag.slug !== FICTION_SLUG && tag.slug !== NON_FICTION_SLUG)
            .map((tag) => (
              <Tag key={tag.slug} tone="on" onPress={busy ? undefined : () => onUnsay(tag.slug)}>
                {tag.label}
              </Tag>
            ))}
          <AddTag onPress={onOpenNaming}>Add a tag</AddTag>
        </Tags>
      </Card>

      {/* Only while nothing has been said. It is the sentence #304 is, and a
          screen that kept saying it after somebody answered would be arguing
          with them. */}
      {carried.length === 0 && (
        <Said>Nothing is chosen. No catalogue said, and this app does not guess.</Said>
      )}

      <Card weight="quiet" kind="Why those two are different" title="They decide which bookcase">
        <p>
          Fiction and non-fiction are what a rule about a whole bookcase asks, so
          answering one of them files the book. Anything else is yours to keep
          and files nothing until a rule asks for it.
        </p>
      </Card>

      {/* The same target, and not the same sentence. "Leave it for now" is
          right for a book nobody has answered and wrong the second somebody
          has: they did not leave it. Found by pressing Fiction and reading the
          screen back. */}
      <Button tone="quiet" block onPress={onBack}>
        {saidHere ? 'Done with this one' : 'Leave it for now'}
      </Button>
    </RoomFrame>
  )
}
