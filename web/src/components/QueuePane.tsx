import { useCallback, useEffect, useState } from 'react'
import { api, deviceName, type Capture, type QueueCounts } from '../lib/api'
import { newestFirst } from '../lib/queueOrder'
import { coverUrl } from './PlacementCard'
import { ConfirmDialog } from './ConfirmDialog'

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
  const [discarding, setDiscarding] = useState<Capture | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    api.listCaptures()
      .then((result) => {
        // The server lists oldest first, the order the background worker
        // reads them in. The stack is on top, not the bottom, so newest
        // first is what the display shows.
        setCaptures(newestFirst(result.captures))
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

  const discard = async () => {
    if (!discarding) return
    setDeleting(true)
    try {
      const result = await api.deleteCapture(discarding.id)
      setDiscarding(null)
      if (result.photosRemoved === 0) {
        // Its photos are still in use by the book it became, so they stay.
        setError('Removed from the queue. Its photos belong to a shelved book, so they were kept.')
      }
      load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const photoCount = (capture: Capture) =>
    [capture.front_image, capture.back_image, capture.edge_image].filter(Boolean).length

  return (
    <main className="main">
      <h2 className="pane-title">Queue</h2>

      {discarding && (
        <ConfirmDialog
          title="Discard this book?"
          body={
            `It will be removed from the queue and its ${photoCount(discarding)} ` +
            'photo(s) deleted from disk. This cannot be undone.'
          }
          confirmLabel="Discard and delete"
          busy={deleting}
          onCancel={() => setDiscarding(null)}
          onConfirm={discard}
        />
      )}
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
                {!capture.isbn13 && capture.cover_text && (
                  <span className="queue__cover">
                    Cover reads: {capture.cover_text.split('\n').join(' / ')}
                  </span>
                )}
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
                <button className="btn btn--ghost" onClick={() => setDiscarding(capture)}>
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
