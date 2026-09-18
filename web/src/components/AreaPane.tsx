import type { ReactElement } from 'react'
import { Card } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { List, Row } from '../design/List'
import { FilterRule, MoveBooks, SortRule } from '../design/Rules'
import { Shelf } from '../design/Shelf'
import { Sure } from '../design/Sure'
import { board } from '../lib/bookLook'
import type {
  AreaBook, AreaDto, AreaRemovalPlan, FixtureDto, FurnitureDto, SortStrategyCode,
} from '../lib/api'
import {
  areaSettled, counted, fixtureOrdering, inOrder, orderEnds, orderingSaid, orderingWarning,
  pieceSaid, plural, reaching, sampleOrdered, skippedSaid, sortOptions,
} from '../lib/furniture'
import { draftHolds, saidRules } from '../lib/ruleWriting'
import { Changing, Refusing } from './Changing'
import { RoomFrame, Trouble } from './RoomFrame'
import { Unsaved } from './Unsaved'
import type { Writing } from '../app/writing'

/** What being asked to remove this area looks like, once the server has answered. */
export type Asking =
  | { kind: 'merge'; plan: AreaRemovalPlan }
  /** The only area on its piece: there is nowhere on it for the books to go. */
  | { kind: 'only'; said: string }
  /**
   * Grouped with the two removal states because there is one overlay slot for
   * this screen; a second piece of state for it would allow two dialogs open
   * at once.
   */
  | { kind: 'unsaved' }

/** What the sort rule is doing while somebody is changing it. */
export interface Sorting {
  open: boolean
  chosen: SortStrategyCode
  /** What the server said the change does, once it has refused once. */
  effect: string
  busy: boolean
}

interface Props {
  room: FurnitureDto | null
  piece: FixtureDto | null
  area: AreaDto | null
  /** What they have typed into the name, which is not saved until they say so. */
  name: string
  /** What is standing here, in the order it stands. Empty while it loads. */
  books: AreaBook[]
  sorting: Sorting
  /** The rule under a thumb, the plan it made, and what the write did. */
  writing: Writing
  asking: Asking | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onName: (name: string) => void
  onSaveName: () => void
  /** Point the whole stretch at other furniture: #244's journey, demoted. */
  onChange: () => void
  /** Where the books a change made go: the carry list this app already keeps. */
  onCarry: () => void
  onOpenSort: () => void
  onChooseSort: (code: SortStrategyCode) => void
  onSaveSort: () => void
  onCloseSort: () => void
  /** Why one book is here, which is the screen both this and a book reach. */
  onClaimed: (bookId: number) => void
  onAsk: () => void
  onKeep: () => void
  onRemove: () => void
  /**
   * Beside `onBack`, not instead of it: only this pane can tell the two
   * apart, since it holds the typed name against the saved one.
   */
  onAskLeave: () => void
  /** The way out of the last state: the piece itself is what has to go. */
  onPiece: () => void
}

/**
 * The place as it stands, or the draft under a thumb, or the answer the
 * server gave when it was asked what the draft would do; all three built by
 * the same function in `domain/placement/phrasing.ts`.
 */
export const holdsHere = (writing: Writing, standing: string): string => {
  if (writing.plan) return writing.plan.holds
  if (writing.on) return draftHolds(writing.vocabulary, writing.rules)
  return standing
}

export function AreaPane({
  room, piece, area, name, books, sorting, writing, asking, busy, error, tabs,
  onBack, onName, onSaveName, onChange, onCarry, onAskLeave,
  onOpenSort, onChooseSort, onSaveSort, onCloseSort,
  onClaimed, onAsk, onKeep, onRemove, onPiece,
}: Props) {
  const top = (
    <TopBar
      title={area ? area.label : 'An area'}
      sub={area && piece ? `${plural(area.books, 'book')}, on ${pieceSaid(piece)}` : undefined}
      onBack={area && name.trim() !== area.name ? onAskLeave : onBack}
    />
  )

  if (!room || !piece || !area) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  if (area.gone) {
    // `counted` spells the number out in words, so the sentence's leading
    // capital has to be added by hand.
    const said = counted(area.books, 'book')
    const standing = `${said.charAt(0).toUpperCase()}${said.slice(1)} `
      + `${area.books === 1 ? 'is' : 'are'} still recorded there, on ${pieceSaid(piece)}.`

    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />

        <Card
          weight="quiet"
          kind={`${area.label} was taken out`}
          title={standing}
        >
          <p>
            Nothing has moved. {area.books === 1 ? 'It stays' : 'They stay'} recorded
            here until you carry {area.books === 1 ? 'it' : 'them'} and say where{' '}
            {area.books === 1 ? 'it' : 'they'} went, which is what the carrying list is
            for.
          </p>
        </Card>

        {books.length > 0 && (
          <div className="wf-bleed">
            <Shelf label={area.label} items={board(inOrder(area.ordering, books), onClaimed)} />
          </div>
        )}

        <Button tone="quiet" block onPress={onPiece}>
          Go to {pieceSaid(piece)}
        </Button>
      </RoomFrame>
    )
  }

  const from = pieceSaid(piece)
  const won = area.rule
  const orphans = books.filter((book) => book.claimedBy === null)
  // Whichever ordering is being looked at: the one under a thumb while open,
  // otherwise the one in force, so the sample reorders live as it is picked.
  const looking = sorting.open && sorting.chosen !== 'inherit'
    ? sorting.chosen
    : sorting.open ? fixtureOrdering(room, piece) : area.ordering
  const { sample, more } = sampleOrdered(looking, books)

  const orphansSaid = counted(orphans.length, 'book')
  const orphansTitle = `${orphansSaid.charAt(0).toUpperCase()}${orphansSaid.slice(1)} here `
    + `${orphans.length === 1 ? 'matches' : 'match'} no rule at all`

  return (
    <RoomFrame top={top} tabs={tabs} over={asked(asking, area, piece, name, onRemove, onKeep, onPiece, onBack)}>
      <Trouble said={error} />

      <Field
        label="What you call this area"
        placeholder="Not named"
        value={name}
        onChange={onName}
      />
      {/* Appears only when there is something to keep: saving on every
          keystroke or silently on blur would both be unwanted writes. */}
      {name.trim() !== area.name && (
        <Button tone="secondary" block onPress={busy ? undefined : onSaveName}>
          {busy ? 'Saving' : `Call it ${name.trim() || 'nothing'}`}
        </Button>
      )}

      <FilterRule
        holds={holdsHere(writing, area.holds)}
        rules={saidRules(area.own.length ? area.own : won ? [won] : [])}
        // `own` is whether this area has its own rules, which is what editing
        // opens; `rules` is every rule reaching here, and the two differ on a
        // plank that takes overflow.
        own={area.own.length > 0}
        beaten={reaching(room, area, piece)}
        editing={writing.editing}
        onEdit={writing.start}
      />

      <Refusing said={writing.error} />
      <Changing writing={writing} onCarry={onCarry} />

      <SortRule
        // The ordering in force, not the one under a thumb (that is `ends`
        // and `sample` below): the two must read as different lines, or
        // "Leave it as it is" has nothing to point back to.
        said={orderingSaid(area.ordering, from)}
        ends={orderEnds(looking, books)}
        where={sorting.open ? undefined : areaSettled(piece, area)}
        // `selfContained` and `entry` differ: the first area of a run never
        // takes overflow either way, but only `entry` says the books start here.
        note={area.selfContained
          ? 'It orders itself, so nothing overflows into it from the area before.'
          : area.entry
            ? 'The books start here, so nothing overflows into it from the area before.'
            : 'It takes what overflows from the area before it.'}
        sample={sample}
        more={more}
        open={sorting.open}
        options={sortOptions(room, from, fixtureOrdering(room, piece))}
        chosen={sorting.chosen}
        warn={sorting.open ? orderingWarning(area, sorting.chosen, from) : undefined}
        effect={sorting.effect}
        busy={sorting.busy}
        onOpen={onOpenSort}
        onChoose={(value) => onChooseSort(value as SortStrategyCode)}
        onSave={onSaveSort}
        onClose={onCloseSort}
      />

      {/*
        The board reflects `inOrder`, not the raw fetch order (which is by
        filing key), so it never contradicts the ordering card above it. The
        "Empty" note reads off `area.books`, not `books.length`, since `books`
        is empty while the read is still in flight.
      */}
      <div className="wf-bleed">
        <Shelf
          label={area.label}
          note={area.books === 0 ? 'Empty' : undefined}
          items={board(inOrder(area.ordering, books), onClaimed)}
        />
      </div>

      {!writing.on && (
        <MoveBooks
          onPress={won && won.range ? onChange : undefined}
          refused={won && !won.range
            ? `${won.name} is about this one area, and what can be moved elsewhere is a `
              + 'whole stretch of books that begins on a piece of furniture. What this '
              + 'area allows is still yours to change.'
            : undefined}
        />
      )}

      {orphans.length > 0 && (
        <Card weight="quiet" kind="Claimed by nothing" title={orphansTitle}>
          <p>
            Nothing says what {orphans.length === 1 ? 'it is' : 'they are'} about, so no
            rule wants {orphans.length === 1 ? 'it' : 'them'} and no plan will ever move{' '}
            {orphans.length === 1 ? 'it' : 'them'}. Tagging{' '}
            {orphans.length === 1 ? 'it' : 'them'} is what settles that.
          </p>
          {/* A spine cannot carry the "no rule claims it" note the list showed per row. */}
          <List label="Books here that no rule claims">
            {orphans.map((book) => (
              <Row
                key={book.id}
                title={book.title}
                sub={book.authorFiling}
                onPress={() => onClaimed(book.id)}
              />
            ))}
          </List>
        </Card>
      )}

      <Button tone="danger" block onPress={busy ? undefined : onAsk}>
        Remove this area
      </Button>
    </RoomFrame>
  )
}

/** `joins` says which neighbouring area receives the books; `becomes` is the resulting label shuffle. */
function asked(
  asking: Asking | null,
  area: AreaDto,
  piece: FixtureDto,
  name: string,
  onRemove: () => void,
  onKeep: () => void,
  onPiece: () => void,
  onLeave: () => void,
): ReactElement | undefined {
  if (!asking) return undefined

  if (asking.kind === 'unsaved') {
    return (
      <Unsaved
        typed={name.trim()}
        keeping={`Call it ${name.trim() || 'nothing'}`}
        onLeave={onLeave}
        onStay={onKeep}
      />
    )
  }

  if (asking.kind === 'only') {
    const from = pieceSaid(piece).toLowerCase()
    return (
      <Sure
        title={area.books === 0
          ? `The ${from} has no other area for books to go in`
          : `Its ${plural(area.books, 'book')} have nowhere else on the ${from}`}
        said={
          <>
            Every book sits in an area, and this is the only one the {from} has, so
            there is nothing here for them to join. Deleting the {from} moves them to
            other furniture instead, and shows you where every one goes first.
          </>
        }
        act={`Take the ${from} out of the room`}
        onAct={onPiece}
        onKeep={onKeep}
      />
    )
  }

  const { plan } = asking
  return (
    <Sure
      title={plan.area.books === 0
        ? `No books stand in ${plan.area.label}`
        : `Its ${plural(plan.area.books, 'book')} join ${plan.into.label}`}
      said={
        <>
          {plan.joins === 'next'
            ? `Nothing comes before it, so its books join the area after it rather than the one before, and every area behind that comes forward. `
            : `They stay on ${pieceSaid(piece)} where they are, and nothing is carried. `}
          {plan.joining > 0
            ? `${plural(plan.joining, 'book')} will be filed under ${plan.into.label} from now `
              + 'on, and the app will ask you to confirm each one where it stands, because '
              + 'only somebody standing in front of them can say a book has moved.'
            : 'No book has to be refiled.'}
          {plan.skipped.map((one) => ` ${skippedSaid(one.reason, one.books)}.`)}
        </>
      }
      becomes={plan.becomes}
      act="Remove the area"
      onAct={onRemove}
      onKeep={onKeep}
    />
  )
}
