/**
 * Draws no carpentry: the model does not know which two areas share a board
 * or how tall anything is, so implying either would promise a fact nobody
 * entered. Holds no state; every label is worked out fresh from the room on
 * each render.
 */

import { Card, Instruction } from '../design/Card'
import { FIXTURES_WORD, TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { AddBox, AreaBox, Nest, Order } from '../design/Furniture'
import type { FurnitureDto } from '../lib/api'
import { addAreaSaid, pieceNote, pieceSaid, plural, renamings, roomSaid } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

interface Props {
  room: FurnitureDto | null
  /** Positions into `room.fixtures`, or null when nobody is dragging. Nothing is written until it is saved. */
  ordering: number[] | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onFixture: (id: number) => void
  onArea: (fixtureId: number, areaId: number) => void
  onAddArea: (fixtureId: number) => void
  onAddFixture: () => void
  onOrder: () => void
  onReorder: (order: number[]) => void
  onSaveOrder: () => void
  onKeepOrder: () => void
}

export function FurniturePane({
  room, ordering, busy, error, tabs,
  onBack, onFixture, onArea, onAddArea, onAddFixture,
  onOrder, onReorder, onSaveOrder, onKeepOrder,
}: Props) {
  const top = (
    <TopBar
      title={FIXTURES_WORD}
      sub={room ? roomSaid(room.fixtures) : undefined}
      onBack={onBack}
    />
  )

  // Distinct from an empty room: drawing one would falsely claim somebody's
  // house is empty for as long as the request takes.
  if (!room) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  // The same drag-order column a piece's own page carries, worked from the
  // other end: nothing is written until Save.
  if (ordering) {
    const order = ordering.map((at) => room.fixtures[at]!)
    const renamed = renamings(order)
    // Distinguishes "nothing renamed because nothing moved" from "nothing
    // renamed because everything already has a name": for an all-unnamed
    // room, the first reason would otherwise show a true answer with a false explanation.
    const moved = order.some((piece, at) => piece.id !== room.fixtures[at]!.id)
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Instruction>Drag a piece to where it stands in the room.</Instruction>
        <Trouble said={error} />
        <Order
          slots={order.map((piece) => ({ name: pieceSaid(piece) }))}
          onReorder={(moved) => onReorder(moved.map((at) => ordering[at]!))}
        />
        {/* Room position numbers stay fixed, gaps and duplicates included; only what an unnamed piece and its areas are called changes, since those are worked out from where a piece stands. */}
        <Card
          weight="sunk"
          kind="What they will be called"
          title={renamed.pieces.length
            ? renamed.pieces.map((one) => `${one.from} becomes ${one.to}`).join(', ')
            : moved
              ? 'Nothing is renamed. Every piece keeps what it is called, and so '
                + 'does every area on it.'
              : 'Nothing has moved yet.'}
        >
          {/* Counted from the labels that actually changed, not from the number of areas, so an area already correctly named is not counted. */}
          {renamed.areas.length > 0 && (
            <p>
              Every area is called after the piece it is on. That changes{' '}
              {plural(renamed.areas.length, 'area label')} as well,{' '}
              {renamed.areas[0]!.from} to {renamed.areas[0]!.to} and so on.
            </p>
          )}
        </Card>
        <Button tone="primary" block onPress={busy ? undefined : onSaveOrder}>
          {busy ? 'Saving' : 'Save the order'}
        </Button>
        <Button tone="quiet" block onPress={onKeepOrder}>
          Leave it as it is
        </Button>
      </RoomFrame>
    )
  }

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      {room.fixtures.length === 0 && (
        <Instruction>Nothing is in the room yet. Add the first piece.</Instruction>
      )}

      {room.fixtures.map((piece) => (
        <Nest
          key={piece.id}
          name={pieceSaid(piece)}
          note={pieceNote(piece)}
          holds={piece.holds}
          onPress={() => onFixture(piece.id)}
        >
          {piece.areas.map((area) => (
            <AreaBox
              key={area.id}
              reads={area.label}
              books={area.books}
              holds={area.holds}
              onPress={() => onArea(piece.id, area.id)}
            />
          ))}
          {/* Areas taken out but still holding books; a bookcase a stretch was moved off has none of the areas above but does have these, and previously drew as nothing at all. */}
          {piece.gone.map((area) => (
            <AreaBox
              key={area.id}
              reads={area.label}
              books={area.books}
              gone
              onPress={() => onArea(piece.id, area.id)}
            />
          ))}
          <AddBox onPress={() => onAddArea(piece.id)}>{addAreaSaid(piece.kind)}</AddBox>
        </Nest>
      ))}

      {/* Not "add a bookcase": fixtures include things like crates, so the neutral word is used here even though pieces above are named for what they are. */}
      <Button tone="primary" block onPress={busy ? undefined : onAddFixture}>
        Add a fixture
      </Button>
      {room.fixtures.length > 1 && (
        <Button tone="quiet" block onPress={onOrder}>
          Change the order
        </Button>
      )}
    </RoomFrame>
  )
}
