/**
 * Fiction and non-fiction decide which side of the room a book crosses to;
 * anything else is a tag, which files nothing until a rule asks for it.
 * Nothing is preselected here and nothing ever should be: this app writes a
 * genre only when a person or catalogue actually states one.
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

/** The label comes from the vocabulary rather than being hardcoded; the fallback word is for a collection that has never had either tag yet. */
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

  // Compares against `book.tags.length` rather than checking `carried.length
  // > 0`: a book that already carries a tag on arrival must not be reported
  // as having just been answered.
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

      <Instruction>
        {saidHere
          ? 'What you say is on the book already. Going back says whether a rule took it.'
          : book.why === 'untagged'
            ? 'Nothing knows what this book is, so no rule can ask for it.'
            : 'No rule asks for what this book carries, so nothing files it.'}
      </Instruction>

      <Card weight="sunk" kind="All anybody knows about it" title={book.title}>
        <p>
          {book.authorFiling}
          {known && <> &middot; {known}</>}
        </p>
        {book.standing && <p>It stands on {book.standing.label}.</p>}
      </Card>

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

      {/* Only while nothing has been said: showing this after somebody answered would have the screen arguing with them. */}
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

      <Button tone="quiet" block onPress={onBack}>
        {saidHere ? 'Done with this one' : 'Leave it for now'}
      </Button>
    </RoomFrame>
  )
}
