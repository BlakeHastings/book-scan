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
import { FilterRule, SortRule } from '../design/Rules'
import type { Sorting } from './AreaPane'
import type {
  AreaBook, FixtureDto, FixtureRemoval, FurnitureDto, SortStrategyCode,
} from '../lib/api'
import {
  collectionOrdering, labelsIfNamed, orderingSaid, pieceSaid, places, plural, reaching,
  sampleOrdered, sortOptions,
} from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

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
  /** What the piece still holds, which decides whether it can be taken away. */
  removal: FixtureRemoval | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onDraft: (draft: FixtureDraft) => void
  onSave: () => void
  /** Point the rule at other furniture: the one journey, reached from here. */
  onChange: () => void
  onOpenSort: () => void
  onChooseSort: (code: SortStrategyCode) => void
  onSaveSort: () => void
  onCloseSort: () => void
  onDelete: () => void
}

export function FixturePane({
  room, piece, draft, books, sorting, removal, busy, error, tabs,
  onBack, onDraft, onSave, onChange, onOpenSort, onChooseSort, onSaveSort, onCloseSort, onDelete,
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
  /*
   * The ordering the sample is drawn in: the one in force, or the one under a
   * thumb while the answers are open, so the books reorder as somebody picks
   * rather than after they have committed to it.
   */
  const looking = sorting.open
    ? (sorting.chosen === 'inherit' ? falls : sorting.chosen)
    : (piece.sortStrategy === 'inherit' ? falls : piece.sortStrategy)
  const { sample, more } = sampleOrdered(looking, books)

  return (
    <RoomFrame top={top} tabs={tabs}>
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
      <FilterRule
        holds={piece.holds}
        rule={rule && { name: rule.name, lines: rule.conditions, enabled: rule.enabled }}
        beaten={reaching(room, piece, null)}
        change={rule && rule.range
          ? { word: `Point ${rule.name} somewhere else`, onPress: onChange }
          : undefined}
        refused={rule && !rule.range
          ? `${rule.name} cannot be pointed somewhere else yet.`
          : undefined}
      />

      <SortRule
        said={orderingSaid(piece.sortStrategy, 'the whole library')}
        note={piece.sortStrategy === 'inherit'
          ? `Every area on it that orders nothing of its own is ${
            orderingSaid(falls, 'the whole library').toLowerCase()}.`
          : 'Every area on it that orders nothing of its own is ordered this way.'}
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
