import { SLOTS, SLOT_HINT, SLOT_LABEL, type Slot } from '../lib/scanner'

export type SlotStatus = 'empty' | 'busy' | 'found' | 'none'

interface Props {
  thumbs: Partial<Record<Slot, string>>
  status: Partial<Record<Slot, SlotStatus>>
  active: Slot
  onSelect: (slot: Slot) => void
}

const STATUS_MARK: Record<SlotStatus, string> = {
  empty: '',
  busy: 'reading...',
  found: 'ISBN found',
  none: 'no ISBN',
}

/**
 * Three slots, one per photo. Tapping a slot makes it the target of the
 * shutter, so retaking a bad shot is one tap rather than starting over.
 */
export function CaptureDeck({ thumbs, status, active, onSelect }: Props) {
  return (
    <div className="deck">
      {SLOTS.map((slot) => {
        const state = status[slot] ?? 'empty'
        const thumb = thumbs[slot]
        return (
          <button
            key={slot}
            type="button"
            className={[
              'slot',
              active === slot ? 'slot--active' : '',
              thumb ? 'slot--filled' : '',
              state === 'found' ? 'slot--found' : '',
            ].join(' ')}
            onClick={() => onSelect(slot)}
            title={SLOT_HINT[slot]}
          >
            <span className="slot__frame">
              {thumb
                ? <img src={thumb} alt={SLOT_LABEL[slot]} />
                : <span className="slot__placeholder">{SLOTS.indexOf(slot) + 1}</span>}
            </span>
            <span className="slot__label">{SLOT_LABEL[slot]}</span>
            {STATUS_MARK[state] && (
              <span className={`slot__status slot__status--${state}`}>
                {STATUS_MARK[state]}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
