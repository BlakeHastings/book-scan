/**
 * One piece of furniture: what it is called, what it is, where it stands, and
 * the way to take it out of the room.
 *
 * ## It does not draw the piece
 *
 * There was a drawing of it at the top, the areas under it and a way to cut
 * another one in. The owner took it off (#367): "on the edit view we shouldn't
 * have that there. It should just have what you call it, what it is, where it
 * stands." It is the second time he has given that note about this drawing over
 * a screen that is for something else, the first being the area screen, where
 * "you see Bookcase 2 and that's taking up so much of the screen".
 *
 * Nothing is unreachable for it. Every area, and the way to add one, is on the
 * room, drawn against the piece it belongs to, which is the screen somebody was
 * on before they opened this one.
 *
 * ## You move it by moving it
 *
 * There were two buttons under "where it stands", "move it earlier" and "move
 * it later", and the owner asked for the piece itself to be the thing you take
 * hold of: "maybe it's a drag and drop, they can just drag it and move it
 * between their other things. Keep in mind that that may wrap." So the room is
 * a column you drag within, and the wrap he warned about cannot arise: a column
 * does not wrap, every target is the full width, and the whole room is visible
 * at once at the sizes a room has.
 *
 * ## Why this screen has a Save on it and the room does not
 *
 * A number is not the fact. The fact is that this piece is second of four, and
 * moving it changes what every area on it reads as **and** what every area
 * reads as on whatever it passes. So the three things somebody can change here
 * are held as a draft, the labels they would produce are drawn under them, and
 * one press writes the lot. The preview is worked out by the same function the
 * server works the real one out with; a second spelling of it here is how a
 * screen ends up promising a name the answer disagrees with.
 *
 * ## Delete is fenced, and it says what has to happen first
 *
 * A piece with books on it cannot go, and the refusal is the sentence rather
 * than an error: its books move to other furniture first, which is a real
 * carry. The dashed fence is there so the irreversible thing does not sit
 * shoulder to shoulder with the thing the screen is for, which on a phone is
 * two full-width buttons twelve pixels apart.
 */

import { Card } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { Order } from '../design/Furniture'
import { FilterRule, MoveBooks, SortRule } from '../design/Rules'
import { holdsHere, type Sorting } from './AreaPane'
import { saidRules } from '../lib/ruleWriting'
import { Changing, Refusing } from './Changing'
import type { Writing } from '../app/writing'
import type {
  AreaBook, FixtureDto, FixtureRemoval, FurnitureDto, SortStrategyCode,
} from '../lib/api'
import {
  collectionOrdering, fixtureSettled, labelsIfNamed, orderEnds, orderingSaid, pieceSaid,
  places, plural, reaching, sampleOrdered, sortOptions,
} from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'
import { Unsaved } from './Unsaved'

/** The three things this screen can change, before anybody presses Save. */
export interface FixtureDraft {
  name: string
  kind: string
  /** Where it stands, as positions into the room's own list of pieces. */
  order: number[]
}

interface Props {
  room: FurnitureDto | null
  piece: FixtureDto | null
  draft: FixtureDraft
  /** What is standing on it, in the order it stands. Empty while it loads. */
  books: AreaBook[]
  sorting: Sorting
  /** The rule under a thumb, the plan it made, and what the write did. */
  writing: Writing
  /** What the piece still holds, which decides whether it can be taken away. */
  removal: FixtureRemoval | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  /**
   * Back was pressed with the draft changed and never saved (#430 item 4).
   *
   * The same defect the area's page had, one screen over and with more on it to
   * lose: what a piece is called, what it is, and the order the room stands in
   * are all held here until Save.
   */
  leaving: boolean
  onBack: () => void
  /** Go back and throw the draft away, which is only ever answered out loud. */
  onLeave: () => void
  /** Stay on the screen, with the draft and the Save still on it. */
  onStay: () => void
  onDraft: (draft: FixtureDraft) => void
  onSave: () => void
  /** Move the whole stretch to other furniture: the other journey, demoted. */
  onChange: () => void
  /** Where the books a change made go: the carry list this app already keeps. */
  onCarry: () => void
  onOpenSort: () => void
  onChooseSort: (code: SortStrategyCode) => void
  onSaveSort: () => void
  onCloseSort: () => void
  onDelete: () => void
}

export function FixturePane({
  room, piece, draft, books, sorting, writing, removal, busy, error, tabs, leaving,
  onBack, onLeave, onStay, onDraft, onSave, onChange, onCarry,
  onOpenSort, onChooseSort, onSaveSort, onCloseSort, onDelete,
}: Props) {
  const top = (
    <TopBar
      title={piece ? pieceSaid(piece) : 'A piece of furniture'}
      sub={piece
        ? `${plural(piece.areas.length, 'area')}, ${plural(piece.books, 'book')}`
        : undefined}
      onBack={onBack}
    />
  )

  if (!room || !piece) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  const standing = draft.order.map((at) => room.fixtures[at]!)
  /*
   * The number this piece would end up on: the place it has been dragged into,
   * and not one plus where it sits in the column. The room's numbers are the
   * room's, gaps and duplicates and all, and they stay put while pieces move
   * through them.
   */
  const at = standing.findIndex((one) => one.id === piece.id)
  const wanted = places(standing)[at] ?? piece.position
  const labels = labelsIfNamed(piece, piece.areas, { name: draft.name, position: wanted })

  const rule = piece.rule
  /* What the piece falls back on with no ordering of its own, which is the
     library's and never another piece's: nothing stands above a piece but the
     collection. */
  const falls = collectionOrdering(room)
  /* What this piece is ordered by today, folded through the library where it
     states nothing itself. There is no `ordering` on the wire for a piece the
     way there is for an area, so it is folded here. */
  const inForce = piece.sortStrategy === 'inherit' ? falls : piece.sortStrategy
  /*
   * The ordering the sample is drawn in: the one in force, or the one under a
   * thumb while the answers are open, so the books reorder as somebody picks
   * rather than after they have committed to it.
   */
  const looking = sorting.open
    ? (sorting.chosen === 'inherit' ? falls : sorting.chosen)
    : inForce
  const { sample, more } = sampleOrdered(looking, books)

  return (
    <RoomFrame
      top={top}
      tabs={tabs}
      over={leaving
        ? <Unsaved typed={draft.name.trim()} keeping="Save" onLeave={onLeave} onStay={onStay} />
        : undefined}
    >
      <Trouble said={error} />

      <Field
        label="What you call it"
        placeholder="Not named"
        value={draft.name}
        onChange={(name) => onDraft({ ...draft, name })}
      />

      {/* The owner's own word for the thing, and nothing branches on it. It is
          what puts "desk" into "Add an area to this desk" one screen along. */}
      <Field
        label="What it is"
        placeholder="Bookcase"
        value={draft.kind}
        onChange={(kind) => onDraft({ ...draft, kind })}
      />

      <div>
        <span className="wf-field__label">Where it stands</span>
        <div style={{ height: 6 }} />
        <Order
          slots={standing.map((one) => ({
            name: one.id === piece.id ? (draft.name.trim() || pieceSaid(one)) : pieceSaid(one),
            on: one.id === piece.id,
          }))}
          onReorder={(moved) => onDraft({ ...draft, order: moved.map((at) => draft.order[at]!) })}
        />
      </div>

      <Card
        weight="sunk"
        kind="What it will be called"
        title={labels.length ? labels.join(', ') : 'Nothing yet: it has no areas on it'}
      />

      {/*
        The areas taken out that books are still standing on (#401). The line
        above says the piece has none, which is true of the furniture and was
        the whole of what this page said while forty-six books stood on it. A
        piece accounts for what is on it whatever became of the area holding it,
        and the room draws these as boxes somebody can open.
      */}
      {piece.gone.length > 0 && (
        <Card
          weight="quiet"
          kind={piece.gone.length === 1 ? 'An area you took out' : 'Areas you took out'}
          title={piece.gone
            .map((area) => `${area.label} holds ${plural(area.books, 'book')}`)
            .join(', ')}
        >
          <p>
            Nothing has moved. They stay recorded there until you carry them and say
            where they went.
          </p>
        </Card>
      )}

      <Button tone="primary" block onPress={busy ? undefined : onSave}>
        {busy ? 'Saving' : 'Save'}
      </Button>

      {/*
        The two questions a place answers, drawn by the same two widgets an
        area's page draws them with (#381). A piece and an area are not the same
        thing and neither is flattened into the other: what a piece inherits its
        ordering from is the whole library rather than the thing it stands on,
        and nothing overflows between pieces, so the sentence an area carries
        about taking what comes before it has no counterpart here.
      */}
      {/*
        What the piece allows, and the way to change it (#384). One widget and
        one behaviour, shared with the area's page: "same thing with the
        fixtures: we need to show the user the filter rules, like we only allow
        these tags or whatever, and then the order rules and how they're
        ordered." A piece rule is where a stretch of books begins and carries on
        through every area after it, so the plan a change here produces is a
        bigger one, and the plan is what says so.
      */}
      <FilterRule
        holds={holdsHere(writing, piece.holds)}
        rules={saidRules(piece.own)}
        beaten={reaching(room, piece, null)}
        editing={writing.editing}
        onEdit={writing.start}
      />

      <Refusing said={writing.error} />
      <Changing writing={writing} onCarry={onCarry} />

      {/*
        The same widget the area's page draws, and it leads with the same thing:
        the ordering itself. A piece that follows the library used to head this
        card "The way the whole library does", which is where the answer comes
        from rather than what it is; it says "By the author" now, and where it
        is set is the sentence under it.
      */}
      <SortRule
        /* The ordering in force, open or shut. What is being picked is drawn
           under "How they would stand", and this stays the thing "Leave it as
           it is" goes back to. */
        said={orderingSaid(inForce, 'the whole library')}
        ends={orderEnds(looking, books)}
        where={sorting.open ? undefined : fixtureSettled(piece)}
        sample={sample}
        more={more}
        open={sorting.open}
        options={sortOptions(room, 'the whole library', falls)}
        chosen={sorting.chosen}
        effect={sorting.effect}
        busy={sorting.busy}
        onOpen={onOpenSort}
        onChoose={(value) => onChooseSort(value as SortStrategyCode)}
        onSave={onSaveSort}
        onClose={onCloseSort}
      />

      {/*
        The way to point this piece's books at other furniture, out of the card
        that says what it allows and standing on its own (#405). There is no
        board of books on this page to stand under, because a piece is more than
        one row and "one row of books is one area" is a pinned rule, so it takes
        the same place in the order: after everything about the piece, before
        the one thing that takes the piece away.
      */}
      {!writing.on && (
        <MoveBooks
          onPress={rule && rule.range ? onChange : undefined}
          refused={rule && !rule.range
            ? `${rule.name} cannot be moved to another bookcase yet. What it allows is `
              + 'still yours to change.'
            : undefined}
        />
      )}

      {/*
        The reassurance went and the guarantee did not. What replaces "the books
        do not vanish with it" is the fact of what pressing it does, said in a
        count: a piece with books on it cannot be taken out of the room until
        they have been carried off it.
      */}
      <Card
        weight="quiet"
        kind={removal && removal.books > 0
          ? `Its ${plural(removal.books, 'book')} move to other furniture first`
          : undefined}
        foot={
          <Button tone="danger" block onPress={busy ? undefined : onDelete}>
            Delete fixture
          </Button>
        }
      />
    </RoomFrame>
  )
}
