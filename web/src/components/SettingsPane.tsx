import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Choice, Segmented } from '../design/Controls'
import type { FurnitureDto, LookupStandings, SortStrategyCode } from '../lib/api'
import type { FirstPicture } from '../design/Shots'
import type { Hand } from '../design/Camera'
import { FIRST_PICTURE_WORD } from '../lib/firstPicture'
import { HAND_WORD } from '../lib/hand'
import { catalogueRoll } from '../lib/catalogueWords'
import { orderingSaid } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

/** `orderingSaid` is shared with the area's ordering screen, so both offer the same question in the same words. */
const OFFERED: Exclude<SortStrategyCode, 'inherit' | 'tag'>[] = ['author', 'title', 'published']

interface Props {
  /** Null until the read answers, so the setting never draws a wrong ordering. */
  room: FurnitureDto | null
  /** Which hand, read out of the same place the camera reads it from. */
  hand: Hand
  /** Which picture, read out of the same place a book's page reads it from. */
  firstPicture: FirstPicture
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onOrder: (code: SortStrategyCode) => void
  onHand: (hand: Hand) => void
  onFirstPicture: (first: FirstPicture) => void
  /** Null until the read answers, and null on failure. Either draws no card rather than a card of noughts, which would falsely claim every catalogue had been asked nothing. */
  lookups: LookupStandings | null
}

export function SettingsPane({
  room, hand, firstPicture, busy, error, tabs, lookups,
  onBack, onOrder, onHand, onFirstPicture,
}: Props) {
  const top = <TopBar title="Settings" onBack={onBack} />
  const roll = catalogueRoll(lookups)

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <div>
        <span className="wf-field__label">How your books are ordered</span>
        <div style={{ height: 6 }} />
        {room ? (
          <Choice
            label="How your books are ordered"
            on={room.defaultSortStrategy}
            onPick={(code) => {
              if (!busy && code !== room.defaultSortStrategy) onOrder(code)
            }}
            options={OFFERED.map((code) => ({
              value: code,
              // Nothing offered here inherits, so orderingSaid's second argument is never read.
              word: orderingSaid(code, ''),
            }))}
          />
        ) : (
          <Said>Reading how your books are ordered.</Said>
        )}
      </div>
      <Said>Every bookcase and every area follows this unless it says otherwise.</Said>

      <div>
        <span className="wf-field__label">Which hand you hold the phone in</span>
        <div style={{ height: 6 }} />
        <Segmented
          label="Which hand you hold the phone in"
          on={hand}
          onPick={onHand}
          options={[
            { value: 'left' as Hand, word: HAND_WORD.left },
            { value: 'right' as Hand, word: HAND_WORD.right },
          ]}
        />
      </div>
      <Said>
        The shutter goes to that edge, under the thumb of the hand already
        holding the phone, and the photographs go to the other one.
      </Said>

      <div>
        <span className="wf-field__label">Which picture of a book comes first</span>
        <div style={{ height: 6 }} />
        <Segmented
          label="Which picture of a book comes first"
          on={firstPicture}
          onPick={onFirstPicture}
          options={[
            { value: 'catalogue' as FirstPicture, word: FIRST_PICTURE_WORD.catalogue },
            { value: 'yours' as FirstPicture, word: FIRST_PICTURE_WORD.yours },
          ]}
        />
      </div>
      <Said>
        A book with no downloaded cover opens on the photograph you took, either
        way.
      </Said>

      {roll && (
        <Card kind="Catalogues" title="Where your books are described from">
          <Said>{roll.said}</Said>
          {roll.rows.map((one) => (
            <div key={one.source}>
              <span className="wf-field__label">{one.source}</span>
              <Said>{one.said}</Said>
            </div>
          ))}
          <Said>{roll.keyed}</Said>
        </Card>
      )}

      <Card kind="Nobody signs in" title="Everybody in the house shares one collection">
        <p>
          Nothing here knows who you are. What you choose here is remembered on
          this phone and on no other.
        </p>
      </Card>
    </RoomFrame>
  )
}
