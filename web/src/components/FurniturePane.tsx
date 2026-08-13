/**
 * Your furniture: the room, as boxes inside boxes.
 *
 * The screen the owner asked for first. He is going to sit down with his own
 * bookcases and type them in, so what this has to survive is his room rather
 * than a tidy one: a piece with no name, a piece nothing files onto, a desk
 * with two areas on it, and **two pieces both standing at 4**, which the
 * catalogue records rather than refuses.
 *
 * ## It draws no carpentry
 *
 * A piece, the areas under it, and a way to add another. Not an elevation: the
 * model does not know which two areas share a board or how tall anything is,
 * and a drawing that implied it would be promising a fact nobody has entered.
 *
 * ## Every word on it is worked out, none of it is stored
 *
 * The label on a box, what a piece is called, what an area holds: all of it
 * comes off the answer to `GET /api/fixtures`, and none of it is kept between
 * renders. Rename a piece and every area on it reads differently, which is why
 * this component holds no state at all: it takes the room and draws it.
 */

import { Card, Instruction } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { AddBox, AreaBox, Nest, Order } from '../design/Furniture'
import type { FurnitureDto } from '../lib/api'
import { addAreaSaid, pieceNote, pieceSaid, places, roomSaid } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

interface Props {
  room: FurnitureDto | null
  /**
   * The room as somebody is dragging it, as positions into `room.fixtures`, or
   * null when nobody is. Nothing is written until it is saved.
   */
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
      title="Your furniture"
      sub={room ? roomSaid(room.fixtures) : undefined}
      onBack={onBack}
    />
  )

  // Nothing has come back yet. Drawing an empty room would be saying something
  // false about somebody's house for as long as the first request takes.
  if (!room) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  /*
   * The one thing this screen does that is not about a single piece.
   *
   * It is the same column a piece's own screen carries, working from the other
   * end: there you move the piece you are looking at, here you put the whole
   * room in order without opening five screens to do it. Nothing is written
   * until Save, so a finger that slips costs nothing.
   */
  if (ordering) {
    const order = ordering.map((at) => room.fixtures[at]!)
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Instruction>Drag a piece to where it stands in the room.</Instruction>
        <Trouble said={error} />
        <Order
          slots={order.map((piece) => ({
            label: String(piece.position),
            name: pieceSaid(piece),
          }))}
          places={places(order).map(String)}
          onReorder={(moved) => onReorder(moved.map((at) => ordering[at]!))}
        />
        {/* What each piece ends up numbered, which is the whole of what saving
            does: a piece's number is where it stands, and every area on it is
            called after it. The numbers themselves do not change, because they
            are this room's and it is allowed to have a gap in them. */}
        <Card
          weight="sunk"
          kind="What they will be numbered"
          title={order
            .map((piece, at) => `${pieceSaid(piece)} ${places(order)[at]}`)
            .join(', ')}
        />
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
          <AddBox onPress={() => onAddArea(piece.id)}>{addAreaSaid(piece.kind)}</AddBox>
        </Nest>
      ))}

      {/* Not "add a bookcase". They are fixtures, not bookcases: the next one
          somebody adds is a crate, so the category word goes neutral even
          though every piece above it is named for what it is. */}
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
