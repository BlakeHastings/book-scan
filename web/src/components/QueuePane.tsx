import { useCallback, useEffect, useState } from 'react'
import { api, deviceName, type Capture, type QueueCounts } from '../lib/api'
import { coverUrl } from './PlacementCard'

const STATUS_LABEL: Record<string, string> = {
  pending: 'reading photos',
  ready: 'identified',
  failed: 'needs you',
  done: 'shelved',
}

interface Props {
  onOpen: (capture: Capture) => void
  onCounts: (counts: QueueCounts) => void
}

/**
 * Books photographed but not yet filed. Polls while anything is still being
 * read, so a capture stops saying "reading photos" without a manual refresh,
 * and so a second person's work appears here too.
 */
export function QueuePane({ onOpen, onCounts }: Props) {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const me = deviceName()

  const load = useCallback(() => {
    api.listCaptures()
      .then((result) => {
        setCaptures(result.captures)
        onCounts(result.counts)
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false))
  }, [onCounts])

  useEffect(() => {
    load()
  }, [load])

  const anyPending = captures.some((c) => c.status === 'pending')

  useEffect(() => {
    // Only poll while there is something to wait for.
    if (!anyPending) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [anyPending, load])

  const open = async (capture: Capture) => {
    setError('')
    try {
      // Claiming is what stops two people filling in the same book.
      const { capture: claimed } = await api.claimCapture(capture.id, me)
      onOpen(claimed)
    } catch (caught) {
      setError((caught as Error).message)
      load()
    }
  }

  return (
    <main className="main">
      <h2 className="pane-title">Queue</h2>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {loading && <p className="hint">Loading...</p>}

      {!loading && captures.length === 0 && (
        <p className="hint">
          Nothing waiting. Photographed books appear here while they are read.
        </p>
      )}

      <ul className="queue">
        {captures.map((capture) => {
          const draft = capture.draft_json
            ? (JSON.parse(capture.draft_json) as { title?: string; authors?: string[] })
            : null
          const heldByOther = capture.claimed_by && capture.claimed_by !== me
          const thumb = capture.edge_image || capture.front_image || capture.back_image

          return (
            <li key={capture.id} className={`queue__row queue__row--${capture.status}`}>
              <span className="queue__photo">
                {thumb && <img src={coverUrl(thumb)} alt="" loading="lazy" />}
              </span>

              <span className="queue__body">
                <span className="queue__title">
                  {draft?.title || capture.title_guess || `Book #${capture.id}`}
                </span>
                <span className="queue__meta">
                  {draft?.authors?.join(', ') || capture.isbn13 || 'no ISBN yet'}
                </span>
                <span className={`queue__status queue__status--${capture.status}`}>
                  {STATUS_LABEL[capture.status]}
                  {heldByOther ? ` · with ${capture.claimed_by}` : ''}
                </span>
                {capture.note && capture.status === 'failed' && (
                  <span className="queue__note">{capture.note}</span>
                )}
              </span>

              <span className="queue__actions">
                <button
                  className="btn btn--primary"
                  onClick={() => open(capture)}
                  disabled={capture.status === 'pending'}
                >
                  {capture.status === 'pending' ? '...' : 'Shelve'}
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={() => api.deleteCapture(capture.id).then(load)}
                >
                  Discard
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
