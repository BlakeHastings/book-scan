/**
 * The capture on the review screen, asked about until the queue has finished
 * reading it.
 *
 * The camera hands a book over as soon as its photographs have arrived, not
 * when they have been read, so review can open on a capture the queue is still
 * working on. What the reading finds is offered to the form when it lands, and
 * only into a form nobody has started on: a person's typing wins over a
 * background pass that finishes behind it.
 *
 * It also answers whether the ISBN is already on a shelf, every time it asks,
 * because that answer can only arrive with the reading.
 */

import { useEffect, useRef, useState } from 'react'
import { api, type LookupResponse } from '../lib/api'
import { evidenceOf, useBookInHand } from './bookInHand'

const EVERY_MS = 1500

/** True while the capture in review has photographs the queue has not finished reading. */
export function useStillReading(): boolean {
  const {
    bookId, captureId, draft, identified,
    applyLookup, applyReading, setEvidence, setCatalogued,
  } = useBookInHand()
  const [reading, setReading] = useState(false)

  // Read when the answer lands rather than when the poll started, so typing in
  // the meantime counts.
  const untouched = useRef(true)
  untouched.current = !identified && !draft.title.trim() && !draft.authors.trim() && !draft.isbn13.trim()

  useEffect(() => {
    setReading(false)
    if (bookId !== null || captureId === null) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // Only a capture seen unread is given what the reading found; one opened
    // already read was laid out from it by whoever opened it.
    let sawItUnread = false

    const ask = async () => {
      try {
        const { capture, catalogued } = await api.getCapture(captureId)
        if (cancelled) return
        setCatalogued(catalogued)

        if (capture.status === 'pending') {
          sawItUnread = true
          setReading(true)
          timer = setTimeout(() => void ask(), EVERY_MS)
          return
        }

        setReading(false)
        if (!sawItUnread) return
        setEvidence(evidenceOf(capture))
        if (capture.status === 'ready' && capture.draft_json && untouched.current) {
          const looked = JSON.parse(capture.draft_json) as LookupResponse
          if (looked.found) applyLookup(looked, capture.isbn_source)
        }
        if (capture.status === 'failed') applyReading(capture)
      } catch {
        // A finding beside a form somebody is filling in is not worth an
        // error over it; the next ask is the retry.
        if (!cancelled && sawItUnread) timer = setTimeout(() => void ask(), EVERY_MS)
      }
    }

    void ask()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [bookId, captureId, applyLookup, applyReading, setEvidence, setCatalogued])

  return reading
}
