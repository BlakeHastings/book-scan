/**
 * One area, and what you can change about it.
 *
 * **It does not draw the piece it sits on.** The whole of the bookcase used to
 * stand at the top of this, above everything the screen is for. The owner:
 * "when we're in the area view we don't need to show the bookcase any more. You
 * see Bookcase 2 and that's taking up so much of the screen." Which piece it is
 * on is not lost and never needed a drawing: the top bar says it in four words
 * and the arrow beside them goes there.
 *
 * ## The two rules are shown here rather than linked to (#381)
 *
 * > On the area detail view, it's not very obvious at all how to change the
 * > rules. I see "Fiction carrying on", "what belongs here", "see what belongs
 * > here", and if I click that I can then see Fiction, the rule [...] and then
 * > it says "point Fiction somewhere else". This doesn't seem like it's working
 * > correctly. [...] Instead of "see what belongs here" we should just show what
 * > belongs there, and then have the ability to edit it if the user clicks it.
 * > And then how it's ordered is another one.
 *
 * Two screens went with that: the one that explained what belongs here and the
 * one that asked how it should be ordered. Both are `design/Rules.tsx` now, and
 * the piece's own page draws the same two widgets, so the two places that answer
 * these questions answer them identically by being one drawing.
 *
 * **Only one of the two is edited here.** How it is ordered is written from this
 * page, because there is nowhere else that does it and the server refuses the
 * change until somebody has been shown what it does. What belongs here is a
 * *door*: changing a rule is what makes books need carrying, and this app has
 * one journey for that, which says where every book would go before it writes
 * anything. Growing a second one beside it would be two answers to where the
 * books go. See `screens/ArrangeScreen.tsx`.
 *
 * ## Removing an area is a merge, and the dialog must not say otherwise
 *
 * The books stay on the piece they are on. What changes is which area the rules
 * say they are in, and therefore what label they will be looked for under. The
 * drawn dialog ended "2B holds 42 books afterwards", and that number is one
 * this app cannot honestly print: **a count on an area is where somebody last
 * said the books were**, and only `PATCH /api/books/:id/location` changes that.
 * Removing an area writes assignments, which is what the rules want, and the
 * difference between the two is the needs-attention list that already exists.
 *
 * So the sentence says what is written and who has to confirm it, and the
 * number in it is `joining`, which is the count the server actually answers
 * with: how many books get refiled, pinned ones excluded and said out loud.
 *
 * ## `pinned` is never a silent subtraction
 *
 * Where the plan leaves books alone it says how many and why, on the screen,
 * under the sentence. A dialog that said "18 books join 2B" having quietly left
 * three pinned ones out of the eighteen would be lying by omission at the one
 * moment somebody is deciding about their own books.
 *
 * ## The fence around removing it came off
 *
 * > I also don't like how "remove this area" is surrounded in a dotted box.
 *
 * It wore the piece's dashed outline so the irreversible thing did not sit
 * shoulder to shoulder with the thing the screen is for. What kept that true
 * without the box is where it sits: last, under everything else, with a dialog
 * in front of it that says what it does to somebody's books.
 */

import type { ReactElement } from 'react'
import { Card } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { List, Row } from '../design/List'
import { FilterRule, SortRule } from '../design/Rules'
import type { Cloth } from '../design/Shelf'
import { Sure } from '../design/Sure'
import type {
  AreaBook, AreaDto, AreaRemovalPlan, FixtureDto, FurnitureDto, SortStrategyCode,
} from '../lib/api'
import {
  counted, fixtureOrdering, orderedSaid, pieceSaid, plural, reaching,
  sampleOrdered, skippedSaid, sortOptions,
} from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

/** What being asked to remove this area looks like, once the server has answered. */
export type Asking =
  | { kind: 'merge'; plan: AreaRemovalPlan }
  /** The only area on its piece: there is nowhere on it for the books to go. */
  | { kind: 'only'; said: string }

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
  asking: Asking | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onName: (name: string) => void
  onSaveName: () => void
  /** Point the rule at other furniture: #244's journey, and there is one of it. */
  onChange: () => void
  onOpenSort: () => void
  onChooseSort: (code: SortStrategyCode) => void
  onSaveSort: () => void
  onCloseSort: () => void
  /** Why one book is here, which is the screen both this and a book reach. */
  onClaimed: (bookId: number) => void
  onAsk: () => void
  onKeep: () => void
  onRemove: () => void
  /** The way out of the last state: the piece itself is what has to go. */
  onPiece: () => void
}

const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']
const clothFor = (id: number): Cloth => CLOTHS[Math.abs(id) % CLOTHS.length]!

export function AreaPane({
  room, piece, area, name, books, sorting, asking, busy, error, tabs,
  onBack, onName, onSaveName, onChange, onOpenSort, onChooseSort, onSaveSort, onCloseSort,
  onClaimed, onAsk, onKeep, onRemove, onPiece,
}: Props) {
  const top = (
    <TopBar
      title={area ? area.label : 'An area'}
      sub={area && piece ? `${plural(area.books, 'book')}, on ${pieceSaid(piece)}` : undefined}
      onBack={onBack}
    />
  )

  if (!room || !piece || !area) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  const from = pieceSaid(piece)
  const won = area.rule
  const orphans = books.filter((book) => book.claimedBy === null)
  /*
   * What the sample is drawn in: whichever ordering is being looked at. With
   * the answers closed that is the one in force; with them open it is the one
   * under a thumb, so the books reorder as somebody picks rather than after
   * they have committed to it.
   */
  const looking = sorting.open && sorting.chosen !== 'inherit'
    ? sorting.chosen
    : sorting.open ? fixtureOrdering(room, piece) : area.ordering
  const { sample, more } = sampleOrdered(looking, books)

  // A card title is a sentence and starts like one. `counted` writes the number
  // out in words, so its first character is the one that has to be lifted.
  const orphansSaid = counted(orphans.length, 'book')
  const orphansTitle = `${orphansSaid.charAt(0).toUpperCase()}${orphansSaid.slice(1)} here `
    + `${orphans.length === 1 ? 'matches' : 'match'} no rule at all`

  return (
    <RoomFrame top={top} tabs={tabs} over={asked(asking, area, piece, onRemove, onKeep, onPiece)}>
      <Trouble said={error} />

      <Field
        label="What you call this area"
        placeholder="Not named"
        value={name}
        onChange={onName}
      />
      {/*
        Not in the drawing, which has a name field on a screen with no Save on
        it. Saving on every keystroke would relabel an area four times while
        somebody types "Cookery", and saving silently when the field loses
        focus is a write nobody asked for. So the way to keep it appears when
        there is something to keep.
      */}
      {name.trim() !== area.name && (
        <Button tone="secondary" block onPress={busy ? undefined : onSaveName}>
          {busy ? 'Saving' : `Call it ${name.trim() || 'nothing'}`}
        </Button>
      )}

      <FilterRule
        holds={area.holds}
        rule={won && { name: won.name, lines: won.conditions, enabled: won.enabled }}
        beaten={reaching(room, area, piece)}
        change={won && won.range
          ? { word: `Point ${won.name} somewhere else`, onPress: onChange }
          : undefined}
        refused={won && !won.range
          ? `${won.name} is about this one area, and what can be moved is a whole `
            + 'stretch of books that begins on a piece of furniture. There is nothing '
            + 'here that would move it honestly.'
          : undefined}
      />

      <SortRule
        said={orderedSaid(area, from)}
        /*
         * Three answers and not two. The first area a rule points at is where
         * its books begin, so nothing flows into it from anywhere, and telling
         * somebody standing in front of "Non-fiction starts here" that it takes
         * what overflows from the area before was the pane saying something
         * plainly untrue about the top of every piece. Found by opening it.
         */
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
        effect={sorting.effect}
        busy={sorting.busy}
        onOpen={onOpenSort}
        onChoose={(value) => onChooseSort(value as SortStrategyCode)}
        onSave={onSaveSort}
        onClose={onCloseSort}
      />

      {/*
        The books, each one a way into why it is here. Not folded away: this is
        the page somebody opens when a book turned up somewhere surprising, and
        the book they came about is in this list.
      */}
      {books.length > 0 && (
        <>
          <p className="wf-heading wf-heading--flush">Standing on {area.label}</p>
          <List label={`Books on ${area.label}`}>
            {books.map((book) => (
              <Row
                key={book.id}
                title={book.title}
                sub={book.authorFiling}
                cloth={clothFor(book.id)}
                meta={book.claimedBy === null ? 'No rule claims it' : undefined}
                onPress={() => onClaimed(book.id)}
              />
            ))}
          </List>
        </>
      )}

      {/*
        A book no rule claims is a real state since #304: nothing states a genre,
        no tag is written, no rule matches it. It stands where somebody put it
        and no plan will ever move it, which is invisible from the counts.
      */}
      {orphans.length > 0 && (
        <Card weight="quiet" kind="Claimed by nothing" title={orphansTitle}>
          <p>
            Nothing says what {orphans.length === 1 ? 'it is' : 'they are'} about, so no
            rule wants {orphans.length === 1 ? 'it' : 'them'} and no plan will ever move{' '}
            {orphans.length === 1 ? 'it' : 'them'}. Tagging{' '}
            {orphans.length === 1 ? 'it' : 'them'} is what settles that.
          </p>
        </Card>
      )}

      {/* Last, and no longer inside a dashed box: "I also don't like how
          'remove this area' is surrounded in a dotted box." What keeps it from
          being pressed by accident is where it sits and the dialog in front of
          it, which is a better place to say what it does than a caption nobody
          read on the way past. */}
      <Button tone="danger" block onPress={busy ? undefined : onAsk}>
        Remove this area
      </Button>
    </RoomFrame>
  )
}

/**
 * The dialog, in whichever of its states applies.
 *
 * Two of the three states the gallery drew are one call to the server: which
 * area takes the books in and whether it is the one before or the one after is
 * `joins`, and the shuffle of labels behind it is `becomes`, drawn rather than
 * described. The third state is the refusal, and it lands on the piece,
 * because the only way out of it is the piece itself going.
 */
function asked(
  asking: Asking | null,
  area: AreaDto,
  piece: FixtureDto,
  onRemove: () => void,
  onKeep: () => void,
  onPiece: () => void,
): ReactElement | undefined {
  if (!asking) return undefined

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
