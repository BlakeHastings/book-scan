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
 * person is the sensor, and the question they are asked is always the same
 * one: does the book in your hand go in yet? Each "no" takes one more book off
 * the end of that shelf and asks again. One book coming off is often not
 * enough, and the loop is what makes that recoverable.
 *
 * The shelf being asked about is read fresh from the placement every time
 * rather than remembered. Moving a book off the end moves the boundary too, so
 * a book that sorts near the end can legitimately change shelves partway
 * through, and a remembered label would go on naming the wrong one.
 */
export function ShelveView({
  placement, range, title, saving, onShelved, onBack, onRefresh,
}: Props) {
  const [steps, setSteps] = useState<Step[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The derived shelf, not suggestedLocation: that belongs to the old
  // per-book scheme and names shelves the layout has never heard of.
  const shelfLabel = placement?.derivedLocation ?? ''
  const last = steps[steps.length - 1]
  // Somewhere books have been pushed into, that is not where this book goes.
  const pushedInto = last && last.to !== shelfLabel ? last.to : ''

  const overflowFrom = async (label: string, kind: 'shelf' | 'area') => {
    if (!label || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api.overflowShelf(range, label, kind)
      setSteps((done) => [...done, {
        title: result.step?.title || 'the last book',
        from: result.step?.from ?? label,
        to: result.step?.to ?? '',
      }])
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

  return (
    <main className="main">
      <h2 className="pane-title">Shelve {title}</h2>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      <PlacementView placement={placement} pending={busy} />

      {steps.length > 0 && (
        <div className="moves">
          <strong>Take these off the shelf, in this order</strong>
          <ol>
            {steps.map((step, i) => (
              <li key={i}>
                <strong>{step.title}</strong> from {step.from} to <strong>{step.to}</strong>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="shelve__ask">
        {/* Always about the book in hand. Asking whether the book you just
            displaced fits somewhere else loses track of the one you actually
            came here to shelve. */}
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
          <button className="btn" onClick={() => overflowFrom(shelfLabel, 'area')} disabled={busy || saving}>
            {busy ? '...' : steps.length > 0 ? 'Still no room, move another' : 'No room, move one along'}
          </button>
          <button className="btn" onClick={() => overflowFrom(shelfLabel, 'shelf')} disabled={busy || saving}>
            No room, start a new bookcase
          </button>
        </div>

        <p className="hint">
          Each time you say there is no room, one more book comes off the end of
          {' '}{shelfLabel || 'the shelf'} and the same question is asked again.
        </p>
      </div>

      {/* The knock-on. Books pushed onto the next shelf can overfill that one,
          and it is the only shelf here that is not the one being asked about. */}
      {pushedInto && (
        <div className="shelve__knockon">
          <p>
            Did everything you moved fit on <strong>{pushedInto}</strong>?
          </p>
          <div className="actions">
            <button className="btn" onClick={() => overflowFrom(pushedInto, 'area')} disabled={busy || saving}>
              No, push {pushedInto}&apos;s last book along too
            </button>
          </div>
        </div>
      )}

      <div className="actions">
        <button className="btn btn--ghost" onClick={onBack} disabled={saving || busy}>
          Back to book details
        </button>
      </div>
    </main>
  )
}

export type { Move }
