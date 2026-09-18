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
  places, plural, reaching, sampleOrdered, sortOptions, stillHolds,
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
  leaving: boolean
  /** Whether the draft says anything the room does not; computed by the screen that seeds the draft. */
  unsaved: boolean
  onBack: () => void
  /** Back, with a draft nobody has saved. The two are told apart by `unsaved`. */
  onAskLeave: () => void
  /** Stay on the screen, with the draft and the Save still on it. */
  onStay: () => void
  onDraft: (draft: FixtureDraft) => void
  onSave: () => void
  /** Move the whole stretch to other furniture. */
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
  room, piece, draft, books, sorting, writing, removal, busy, error, tabs, leaving, unsaved,
  onBack, onAskLeave, onStay, onDraft, onSave, onChange, onCarry,
  onOpenSort, onChooseSort, onSaveSort, onCloseSort, onDelete,
}: Props) {
  const top = (
    <TopBar
      title={piece ? pieceSaid(piece) : 'A piece of furniture'}
      sub={piece
        ? `${plural(piece.areas.length, 'area')}, ${plural(piece.books, 'book')}`
        : undefined}
      onBack={unsaved ? onAskLeave : onBack}
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
  // Room position numbers can have gaps and duplicates and stay put while
  // pieces move through them; `wanted` is the number this piece would land
  // on if dropped here, not an index-based renumbering.
  const at = standing.findIndex((one) => one.id === piece.id)
  const wanted = places(standing)[at] ?? piece.position
  // Same function the server uses to compute labels, so this screen cannot
  // promise a name the server disagrees with.
  const labels = labelsIfNamed(piece, piece.areas, { name: draft.name, position: wanted })

  const rule = piece.rule
  // A piece with no ordering of its own always falls back to the library's,
  // never another piece's.
  const falls = collectionOrdering(room)
  // There is no `ordering` field on the wire for a piece the way there is for
  // an area, so this folds the library fallback in here instead.
  const inForce = piece.sortStrategy === 'inherit' ? falls : piece.sortStrategy
  // Uses the ordering under the thumb while choices are open, so the sample
  // reorders live as somebody picks rather than only after they commit.
  const looking = sorting.open
    ? (sorting.chosen === 'inherit' ? falls : sorting.chosen)
    : inForce
  const { sample, more } = sampleOrdered(looking, books)

  return (
    <RoomFrame
      top={top}
      tabs={tabs}
      over={leaving
        ? <Unsaved typed={draft.name.trim()} keeping="Save" onLeave={onBack} onStay={onStay} />
        : undefined}
    >
      <Trouble said={error} />

      <Field
        label="What you call it"
        placeholder="Not named"
        value={draft.name}
        onChange={(name) => onDraft({ ...draft, name })}
      />

      {/* This value is what fills in "Add an area to this desk" on another screen; nothing here branches on it. */}
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

      {/* A piece accounts for books on it even after the area holding them is gone; `piece.gone` lists those removed areas separately from the piece's current ones. */}
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

      {/* A piece is not an area: it inherits ordering from the whole library rather than from what it stands on, and nothing overflows between pieces. A rule on a piece begins a stretch that carries on through every area after it, so a change here produces a larger plan than an area's own rule would. */}
      <FilterRule
        holds={holdsHere(writing, piece.holds)}
        rules={saidRules(piece.own)}
        beaten={reaching(room, piece, null)}
        editing={writing.editing}
        onEdit={writing.start}
      />

      <Refusing said={writing.error} />
      <Changing writing={writing} onCarry={onCarry} />

      <SortRule
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

      {/* No board of books here: a piece is more than one row, and "one row of books is one area" is a pinned rule elsewhere. */}
      {!writing.on && (
        <MoveBooks
          onPress={rule && rule.range ? onChange : undefined}
          refused={rule && !rule.range
            ? `${rule.name} cannot be moved to another bookcase yet. What it allows is `
              + 'still yours to change.'
            : undefined}
        />
      )}

      {/* A piece cannot be removed while it still holds books, or while the carry list is still sending books to it; `stillHolds` says which. */}
      <Card
        weight="quiet"
        kind={stillHolds(removal)}
        foot={
          <Button tone="danger" block onPress={busy ? undefined : onDelete}>
            Delete fixture
          </Button>
        }
      />
    </RoomFrame>
  )
}
