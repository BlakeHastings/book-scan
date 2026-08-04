import { useState } from 'react'
import { api, type Move, type PlacementResponse } from '../lib/api'
import { PlacementView } from './ShelfStrip'
import type { ShelfRange } from '../../shared/shelving'

interface Props {
  placement: PlacementResponse | null
  range: ShelfRange
  title: string
  saving: boolean
  onShelved: () => void
  onBack: () => void
  /** Re-read placement after a move, so the strip shows the shelf as it is now. */
  onRefresh: () => Promise<unknown>
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
 * Nothing here predicts whether a shelf has room, because nothing can:
 * capacity depends on the thickness of whatever is already on it. So the
 * person is the sensor, and the screen only ever asks one question at a time.
 *
 * There are two nested loops, and on a full bookcase both get used:
 *
 *   placing  does the book in your hand go in yet? Each "no" takes one book
 *            off the end of its shelf, which starts a move.
 *   moving   did that displaced book fit on the next shelf? Each "no" takes
 *            one book off the end of THAT shelf, and so on down the bookcase.
 *            When one finally fits, the question goes back to the book in
 *            your hand, which may still not fit, which starts the whole thing
 *            again.
 *
 * Presenting it as one question keeps an arbitrarily deep shimmy legible: the
 * screen never asks about two shelves at once, and the list above it is the
 * physical to-do list in the order it has to happen.
 */
export function ShelveView({
  placement, range, title, saving, onShelved, onBack, onRefresh,
}: Props) {
  const [steps, setSteps] = useState<Step[]>([])
  /** The move awaiting a yes or no. Null means the question is about the book. */
  const [pending, setPending] = useState<Step | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The derived shelf, not suggestedLocation: that belongs to the old
  // per-book scheme and names shelves the layout has never heard of.
  const shelfLabel = placement?.derivedLocation ?? ''

  const overflowFrom = async (label: string, kind: 'shelf' | 'area') => {
    if (!label || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api.overflowShelf(range, label, kind)
      const step: Step = {
        title: result.step?.title || 'the last book',
        from: result.step?.from ?? label,
        to: result.step?.to ?? '',
      }
      setSteps((done) => [...done, step])
      setPending(step)
      // Books have physically moved, so the drawn shelf is a lie until
      // placement is asked again. Awaited, or the next tap acts on the old
      // shelf label and moves a book nobody asked about.
      await onRefresh()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const spread = [...new Set(steps.flatMap((s) => [s.from, s.to]))]

  return (
    <main className="main">
      <h2 className="pane-title">Shelve {title}</h2>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      <PlacementView placement={placement} pending={busy} />

      {steps.length > 0 && (
        <div className="moves">
          <strong>Shuffle, in this order</strong>
          {spread.length > 2 && (
            <p className="moves__spread">{spread.join(' → ')}</p>
          )}
          <ol>
            {steps.map((step, i) => (
              <li key={i} className={step === pending ? 'moves__now' : 'moves__done'}>
                <strong>{step.title}</strong>: end of {step.from} to start of{' '}
                <strong>{step.to}</strong>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="shelve__ask">
        {pending ? (
          /* One shelf along the chain. Answering yes hands the question back
             to the book in your hand; answering no goes one shelf further. */
          <>
            <p>
              Take <strong>{pending.title}</strong> off the end of {pending.from} and
              put it at the start of <strong>{pending.to}</strong>. Did it fit there?
            </p>

            <div className="actions">
              <button
                className="btn btn--primary"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                Yes, it fit
              </button>
            </div>

            <div className="actions">
              <button
                className="btn"
                onClick={() => overflowFrom(pending.to, 'area')}
                disabled={busy}
              >
                {busy ? '...' : `No, ${pending.to} is full too`}
              </button>
            </div>

            <p className="hint">
              Saying no takes the last book off {pending.to} as well, and asks
              about the bookcase after that. The chain can run as far as it needs to.
            </p>
          </>
        ) : (
          <>
            <p>
              Put <strong>{title}</strong> in the gap at <strong>{shelfLabel || '?'}</strong>.
              Does it fit{steps.length > 0 ? ' now' : ''}?
            </p>

            <div className="actions">
              <button className="btn btn--primary" onClick={onShelved} disabled={saving || busy}>
                {saving ? 'Saving...' : 'It fits, save'}
              </button>
            </div>

            <div className="actions">
              {/* Area is the next plank down; shelf is a whole new bookcase. */}
              <button
                className="btn"
                onClick={() => overflowFrom(shelfLabel, 'area')}
                disabled={busy || saving}
              >
                {busy ? '...' : steps.length > 0 ? 'Still no room' : 'No room, move one along'}
              </button>
              <button
                className="btn"
                onClick={() => overflowFrom(shelfLabel, 'shelf')}
                disabled={busy || saving}
              >
                No room, start a new bookcase
              </button>
            </div>

            <p className="hint">
              Each time you say there is no room, one more book comes off the end
              of {shelfLabel || 'the bookcase'} and the same question is asked again.
            </p>
          </>
        )}
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
