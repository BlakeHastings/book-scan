import { useState } from 'react'
import { api, type Move, type PlacementResponse } from '../lib/api'
import { PlacementCard } from './PlacementCard'
import type { ShelfRange } from '../../shared/shelving'

interface Props {
  placement: PlacementResponse | null
  range: ShelfRange
  title: string
  saving: boolean
  onShelved: () => void
  onBack: () => void
}

interface Step {
  title: string
  from: string
  to: string
}

/**
 * Putting the book on the shelf, kept separate from confirming what the book
 * is. They are different jobs: one happens looking at a screen, the other
 * standing at the shelf with a book in your hand.
 *
 * The important control is "It does not fit". Nothing here predicts whether a
 * shelf has room, because nothing can: capacity depends on the thickness of
 * whatever is already there. So the person is the sensor. Each time they say
 * it will not go, one book comes off the end and the question is asked again
 * about the shelf it lands on, until somebody says it fits.
 */
export function ShelveView({
  placement, range, title, saving, onShelved, onBack,
}: Props) {
  const [steps, setSteps] = useState<Step[]>([])
  const [current, setCurrent] = useState<Step | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The derived shelf, not suggestedLocation: that belongs to the old
  // per-book scheme and names shelves the layout has never heard of.
  const shelfLabel = current?.to ?? placement?.derivedLocation ?? ''

  const notEnoughRoom = async (kind: 'shelf' | 'area') => {
    if (!shelfLabel) return
    setBusy(true)
    setError('')
    try {
      const result = await api.overflowShelf(range, shelfLabel, kind)
      const step: Step = {
        title: result.step?.title || 'the last book',
        from: result.step?.from ?? shelfLabel,
        to: result.step?.to ?? '',
      }
      setSteps((done) => [...done, step])
      setCurrent(step)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="main">
      <h2 className="pane-title">Shelve {title}</h2>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {/* Where the new book goes. Unchanged by the cascade: the gap it belongs
          in is decided by the alphabet, not by how full the shelf is. */}
      <PlacementCard placement={placement} pending={false} saved={false} />

      {steps.length > 0 && (
        <div className="moves">
          <strong>Moves so far</strong>
          <ul>
            {steps.map((step, i) => (
              <li key={i}>
                Take <strong>{step.title}</strong> from {step.from} to <strong>{step.to}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="shelve__ask">
        {current ? (
          <p>
            Move <strong>{current.title}</strong> to <strong>{current.to}</strong>.
            Did it fit?
          </p>
        ) : (
          <p>
            Put the book in the gap above, on shelf <strong>{shelfLabel || '?'}</strong>.
            Did it fit?
          </p>
        )}

        <div className="actions">
          <button className="btn btn--primary" onClick={onShelved} disabled={saving || busy}>
            {saving ? 'Saving...' : 'It fits, save'}
          </button>
        </div>

        <div className="actions">
          <button className="btn" onClick={() => notEnoughRoom('shelf')} disabled={busy}>
            {busy ? '...' : 'No room, next shelf'}
          </button>
          <button className="btn" onClick={() => notEnoughRoom('area')} disabled={busy}>
            No room, next area
          </button>
        </div>

        <p className="hint">
          Each time you say there is no room, the last book on that shelf moves
          along and the question is asked again about the shelf it lands on.
        </p>
      </div>

      <div className="actions">
        <button className="btn btn--ghost" onClick={onBack} disabled={saving || busy}>
          Back to book details
        </button>
      </div>
    </main>
  )
}

export type { Move }
