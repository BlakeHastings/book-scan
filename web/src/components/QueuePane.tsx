import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, deviceName, draftFromCapture, editsOn,
  type Capture, type QueueCounts,
} from '../lib/api'
import { newestFirst } from '../lib/queueOrder'
import { coverUrl } from './PlacementCard'
import { ConfirmDialog } from './ConfirmDialog'

const STATUS_LABEL: Record<string, string> = {
  pending: 'reading photos',
  ready: 'identified',
  failed: 'needs you',
  done: 'shelved',
}

/** Where in the displayed list a capture sat when the user opened it. */
export interface QueueReturnAnchor {
  id: number
  index: number
}

interface Props {
  onOpen: (capture: Capture, anchor: QueueReturnAnchor) => void
  onCounts: (counts: QueueCounts) => void
  /**
   * Set when this mount is a return trip: the user opened a capture from
   * here to shelve it and has come back. Used once, to land the list near
   * where they left off, then reported back as consumed.
   */
  returnAnchor?: QueueReturnAnchor | null
  onReturnAnchorConsumed?: () => void
}

/**
 * Books photographed but not yet filed. Polls while anything is still being
 * read, so a capture stops saying "reading photos" without a manual refresh,
 * and so a second person's work appears here too.
 */
export function QueuePane({ onOpen, onCounts, returnAnchor, onReturnAnchorConsumed }: Props) {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const me = deviceName()
  const [discarding, setDiscarding] = useState<Capture | null>(null)
  const [deleting, setDeleting] = useState(false)
  const rows = useRef(new Map<number, HTMLLIElement>())
  // A fresh mount every time the pane is shown (App only renders it while
  // mode === 'queue'), so this only needs to fire once per visit.
  const restored = useRef(false)

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

  useEffect(() => {
    // Land back near the book just handled instead of leaving the person to
    // scroll for it. Runs once per visit: if the opened capture is still
    // here (shelving was cancelled) scroll to it; if it left the queue
    // (shelving finished) scroll to whatever slid into its place.
    if (restored.current || loading || !returnAnchor) return
    restored.current = true

    const stillThere = captures.some((c) => c.id === returnAnchor.id)
    const targetId = stillThere
      ? returnAnchor.id
      : captures[Math.min(returnAnchor.index, captures.length - 1)]?.id

    if (targetId !== undefined) {
      rows.current.get(targetId)?.scrollIntoView({ block: 'center' })
    }
    onReturnAnchorConsumed?.()
  }, [captures, loading, returnAnchor, onReturnAnchorConsumed])

  const open = async (capture: Capture) => {
    setError('')
    try {
      const index = captures.findIndex((c) => c.id === capture.id)
      // Claiming is what stops two people filling in the same book.
      const { capture: claimed } = await api.claimCapture(capture.id, me)
      onOpen(claimed, { id: capture.id, index })
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
          // What anybody has worked out about this book, over what the worker
          // read off its photographs. The row has to show the corrected title,
          // not the one the wrong ISBN produced, or the person coming to shelve
          // it is looking for the wrong book.
          const draft = draftFromCapture(capture)
          const heldByOther = capture.claimed_by && capture.claimed_by !== me
          // Two different facts, and the queue's value is telling them apart:
          // nobody has been near this book, or somebody has and this is where
          // they got to.
          const stated = Object.keys(editsOn(capture)).length > 0
          const looked = capture.edited_at
            ? `${stated ? 'worked on' : 'checked'} by ${capture.edited_by || 'someone'}`
            : ''
          const thumb = capture.edge_image || capture.front_image || capture.back_image

          return (
            <li
              key={capture.id}
              ref={(el) => {
                if (el) rows.current.set(capture.id, el)
                else rows.current.delete(capture.id)
              }}
              className={`queue__row queue__row--${capture.status}`}
            >
              <span className="queue__photo">
                {thumb && <img src={coverUrl(thumb)} alt="" loading="lazy" />}
              </span>

              <span className="queue__body">
                <span className="queue__title">
                  {draft.title || `Book #${capture.id}`}
                </span>
                <span className="queue__meta">
                  {draft.authors || draft.isbn13 || 'no ISBN yet'}
                </span>
                {!capture.isbn13 && capture.cover_text && (
                  <span className="queue__cover">
                    Cover reads: {capture.cover_text.split('\n').join(' / ')}
                  </span>
                )}
                <span className={`queue__status queue__status--${capture.status}`}>
                  {STATUS_LABEL[capture.status]}
                  {heldByOther ? ` · with ${capture.claimed_by}` : ''}
                  {looked ? ` · ${looked}` : ''}
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
