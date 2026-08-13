/**
 * How one area is ordered.
 *
 * ## Choosing one here makes the area a place of its own
 *
 * An area with an order of its own **takes no overflow**, because a continuous
 * run only works while every area in it orders the same way. So this is not a
 * display preference: it cuts the run the area was in, and the areas after it
 * stop being fed by the one before them, which is a different set of books
 * arriving at every one of them.
 *
 * The server refuses the change until the caller says it has shown somebody
 * that, and hands back what to show. The drawing has a card here saying "2C
 * becomes a place of its own", written before there was an answer to draw; what
 * this does is press once, put the server's own sentence in that card, and let
 * the second press be the acknowledgement. The sentence is better than the
 * drawn one because it counts: it says how many areas leave the run.
 *
 * ## Five answers, stacked
 *
 * A segmented control stops working at four options and this question has five,
 * so they stack. Every one is a full-width row with room for a second line,
 * because the second line is where a choice says what it actually means: "the
 * way the bookcase does" means nothing without "by the author's surname today"
 * under it.
 */

import { Card } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Choice } from '../design/Controls'
import type { AreaDto, FixtureDto, FurnitureDto, SortStrategyCode } from '../lib/api'
import { orderingSaid, pieceSaid } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

interface Props {
  room: FurnitureDto | null
  piece: FixtureDto | null
  area: AreaDto | null
  /** What they have chosen, which is not written until they press Save. */
  chosen: SortStrategyCode
  /**
   * What the server said the change does to the runs, once it has refused
   * once. Null until then, and the second press carries the acknowledgement.
   */
  effect: string
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onChoose: (code: SortStrategyCode) => void
  onSave: () => void
}

/**
 * What inheriting would give, which is the fold this area is skipping.
 *
 * The collection, then the piece, and the nearest one that is not "inherit"
 * wins. Two lines rather than an import, because it is two lines and the shape
 * of the answer is the whole of what it says.
 */
function inherited(room: FurnitureDto, piece: FixtureDto): SortStrategyCode {
  if (piece.sortStrategy !== 'inherit') return piece.sortStrategy
  return room.defaultSortStrategy === 'inherit' ? 'author' : room.defaultSortStrategy
}

export function SortingPane({
  room, piece, area, chosen, effect, busy, error, tabs, onBack, onChoose, onSave,
}: Props) {
  const top = (
    <TopBar
      title={area ? `How ${area.label} is ordered` : 'How it is ordered'}
      sub={area?.name || (piece ? pieceSaid(piece) : undefined)}
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
  const falls = inherited(room, piece)

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <Card weight="sunk" kind="Right now" title={orderingSaid(area.ordering, from)} />

      <Choice
        label={`How ${area.label} should be ordered`}
        on={chosen}
        onPick={onChoose}
        options={room.strategies.map((strategy) => ({
          value: strategy.code,
          word: strategy.isInherit
            ? `The way ${from} does`
            : orderingSaid(strategy.code, from, strategy.label),
          sub: strategy.isInherit
            ? `${orderingSaid(falls, from)} today`
            : undefined,
        }))}
      />

      {/* What it does to the run, and the reason the button below says what it
          says. Before the server has been asked this is what choosing one
          means; afterwards it is what the server answered, with the count in
          it. */}
      {chosen !== area.sortStrategy && (
        <Card
          kind={effect ? 'What that does' : 'If you choose one here'}
          title={effect || (chosen === 'inherit'
            ? `${area.label} rejoins the run before it`
            : `${area.label} becomes a place of its own`)}
        />
      )}

      {/* Pressing it having changed nothing is not an error and gets no
          refusal: it saves nothing and leaves, which is what a person who
          pressed Save meant either way. */}
      <Button tone="primary" block onPress={busy ? undefined : onSave}>
        {busy ? 'Saving' : effect ? 'Order it that way' : 'Save'}
      </Button>
      <Button tone="quiet" block onPress={onBack}>
        Leave it as it is
      </Button>
    </RoomFrame>
  )
}
