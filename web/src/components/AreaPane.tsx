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
 * **Both are edited here since #384**, and the second of them reverses what an
 * earlier issue settled. Four issues in a row said not to build a way to change
 * a rule's conditions; the owner then asked for exactly that, on the place the
 * rule applies to, and said why the alternative was not what he meant: "they
 * have the option to point Fiction somewhere else. That's not what the goal is
 * here."
 *
 * What those issues were protecting is intact and is a narrower thing: **there
 * is one way books actually move.** Editing here writes nothing at all. It ends
 * on a plan over every book in the collection, then a write that records where
 * the rules want each of them, then the carry list. Pointing a whole stretch of
 * books at other furniture is still #244's journey and still the only thing that
 * does that; it is the quiet button under the loud one now, which is where the
 * owner put it. See `screens/ArrangeScreen.tsx` and `app/writing.ts`.
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
   * Back was pressed with a name typed into the field and never kept (#430
   * item 4).
   *
   * Not a removal, and here beside the two that are because it is the same
   * thing to this screen: one overlay slot, one place that decides what is over
   * the page. A second piece of state for it would be two dialogs that can both
   * be open.
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
   * Back was pressed with a name typed and never kept.
   *
   * Beside `onBack` rather than instead of it, because the two are different
   * answers to one press and only this pane can tell them apart: it is what
   * holds the typed name against the saved one, one expression above the
   * button that keeps it. The screen goes on naming its own way out and
   * nothing else, which is the rule `app/arranging.test.ts` pins.
   */
  onAskLeave: () => void
  /** The way out of the last state: the piece itself is what has to go. */
  onPiece: () => void
}

/**
 * The phrase at the top of what belongs here, whichever of the three it is.
 *
 * The place as it stands, or the draft under a thumb, or the answer the server
 * gave when it was asked what the draft would do. All three are the same
 * sentence built by the same function in `domain/placement/phrasing.ts`, so the
 * heading never says one thing on the way in and another on the way out.
 */
export const holdsHere = (writing: Writing, standing: string): string => {
  if (writing.plan) return writing.plan.holds
  if (writing.on) return draftHolds(writing.vocabulary, writing.rules)
  return standing
}

/*
 * `levelsFor` was here: the three places an ordering can be settled, drawn as a
 * numbered stack with the one that decides marked "This one decides".
 *
 * It is gone (#405). The owner read it and said "the way that we are
 * representing the sort rule in the widget is not very understandable at all",
 * and the fault was not the arrangement. Two of the three rows always said "the
 * way the thing above me does", which is a pointer rather than an answer, so
 * finding out what order the books were in meant chasing three rows to the one
 * with the badge on it. The three levels are a fact about the model and were
 * never the thing a person came to the page to read.
 *
 * What answers the question instead is `areaSettled`: one sentence naming the
 * place the ordering is really set, which is the place somebody would go to
 * change it. See `lib/furniture.ts`.
 */

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
      /*
       * Two answers to one press, told apart here because this is where the
       * typed name is held against the saved one, one expression above the
       * button that keeps it (#430 item 4). The screen still names the one way
       * out and nothing else.
       */
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

  /*
   * One somebody took out that books are still standing on (#401).
   *
   * A shorter page, and every part it leaves off is a part that would be a lie
   * here: no rule sends books to a place that is not there, nothing overflows
   * into it, renaming it names nothing, and it cannot be taken out again
   * because it is already out. What is true of it is the books, so that is the
   * page: what happened, and every one of them, each a way into why it is here.
   *
   * It exists because this used to answer 404 and the room drew nothing, so a
   * bookcase forty-six books were standing on read as empty on every screen
   * that draws furniture while the carry list named its areas.
   */
  if (area.gone) {
    // A card title is a sentence and starts like one, and `counted` writes the
    // number out in words, so its first character is the one to lift. The same
    // lift the unclaimed card below makes, for the same reason.
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
    <RoomFrame top={top} tabs={tabs} over={asked(asking, area, piece, name, onRemove, onKeep, onPiece, onBack)}>
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

      {/*
        What belongs here, and now the way to change it (#384). The owner asked
        for exactly the thing four issues told an agent not to build: "we want to
        be able to assign any rules that are available [...] if they change the
        rule to say, in an area, I want only comic books, only books with the tag
        comic books and fiction, then that's what is now only allowed in that
        area". What survives from that instruction is the part that was really
        load-bearing, which is that there is one way books move: this ends on a
        plan with counts in it, then a write, then the carry list.
      */}
      <FilterRule
        holds={holdsHere(writing, area.holds)}
        rules={saidRules(area.own.length ? area.own : won ? [won] : [])}
        /*
         * What is drawn is every rule that reaches here; what the button offers
         * is what pressing it opens, which is the rules written on this area.
         * They are different on every plank that takes overflow, and #391 is
         * what saying "Change" there cost: an editor holding nothing, a preview
         * of nothing and a truthful "Nothing changed" read as a failure.
         */
        own={area.own.length > 0}
        beaten={reaching(room, area, piece)}
        editing={writing.editing}
        onEdit={writing.start}
      />

      <Refusing said={writing.error} />
      <Changing writing={writing} onCarry={onCarry} />

      {/*
        How these books read, and the way to change it. The title is the
        ordering itself rather than where it came from, which is the whole of
        what round nine got wrong: "the way bookcase 2 does" is a pointer, and
        somebody standing in front of their own books wants the answer.
      */}
      <SortRule
        /*
         * The ordering **in force**, open or shut, and never the one under a
         * thumb. What is being picked is drawn under "How they would stand",
         * and the two have to be different lines: a card that renamed itself
         * to the answer being considered would leave nothing on the screen
         * saying what "Leave it as it is" goes back to. Found by opening it on
         * a piece of furniture, where it did exactly that.
         */
        said={orderingSaid(area.ordering, from)}
        ends={orderEnds(looking, books)}
        where={sorting.open ? undefined : areaSettled(piece, area)}
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
        /*
         * The consequence, said while the answers are open and before anything
         * is pressed. The server says it again once it has refused a save, and
         * that was the only place it was ever said: a person learned that
         * ordering an area its own way cuts it off from what overflows into it
         * at the moment the save came back refused.
         */
        warn={sorting.open ? orderingWarning(area, sorting.chosen, from) : undefined}
        effect={sorting.effect}
        busy={sorting.busy}
        onOpen={onOpenSort}
        onChoose={(value) => onChooseSort(value as SortStrategyCode)}
        onSave={onSaveSort}
        onClose={onCloseSort}
      />

      {/*
        The books, standing on the board, in the order the ordering above puts
        them (#405). They were a list of rows on the one page in this app that
        is about a physical row of books: "let's switch that to a shelf view
        instead of a list."

        **Not the order the read came back in.** That is by filing key, which is
        the author's, and an area ordered by the year would have drawn a board
        that contradicted the card directly above it. Each spine is still the
        way into why that book is here, which is what the rows were for.

        **An empty area draws an empty board**, where the list drew nothing at
        all. A bare plank with its label on it is the truthful picture of a
        shelf somebody has cleared and written a rule for, and it is the state
        #392 made real: a place can be waiting for its books.

        **The word "Empty" comes off the area rather than off the list**, and
        that is the difference between an empty plank and one whose books have
        not arrived over the wire yet. `books` is empty while the read is in
        flight, so a note taken from its length would have said "Empty" on the
        way into every area in the collection. Found by looking at it.

        **And there is no count on the board**, because the bar two lines above
        it already says "18 books, on bookcase 2". That is the argument the
        library screen already made about putting a plank's label on every row
        under a card titled with it: the same fact twice buries whichever one
        differs.
      */}
      <div className="wf-bleed">
        <Shelf
          label={area.label}
          note={area.books === 0 ? 'Empty' : undefined}
          items={board(inOrder(area.ordering, books), onClaimed)}
        />
      </div>

      {/*
        Where the books are is where the way to move them belongs: "let's move
        that out of where we define the rules. Maybe we move it underneath the
        shelf view." It is the same journey it always was (#244), demoted the
        same way, and it now stands under the thing it acts on rather than
        inside the card that says what this place allows.
      */}
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
          {/*
            Which ones, by name. The list said "No rule claims it" against each
            row, and a board cannot: a spine is a picture of a book and there is
            nowhere on it to write a fact about a rule. So the count that was
            already here names them, which is more use than the note was anyway,
            because it can be read without walking the whole of a long board.
          */}
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
  name: string,
  onRemove: () => void,
  onKeep: () => void,
  onPiece: () => void,
  onLeave: () => void,
): ReactElement | undefined {
  if (!asking) return undefined

  /*
   * Nothing about the area and everything about what is on the screen, so it
   * is answered first and reads the field rather than the room. The words on
   * the button it points at are built here from the same expression that draws
   * that button, because a dialog naming a button that says something else is
   * worse than no dialog.
   */
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
