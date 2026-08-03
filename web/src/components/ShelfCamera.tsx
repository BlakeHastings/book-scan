import { useEffect, useRef, useState } from 'react'
import { api, type BookRow, type CoverMatch } from '../lib/api'
import { coverUrl } from './PlacementCard'
import {
  applyFocusHints, captureStill, listLenses, openCamera, preferredLens,
  rememberedLens, rememberLens, stopStream,
} from '../lib/scanner'

interface Props {
  /** Taking books off the shelf, or bringing them back. */
  mode: 'out' | 'in'
  /** A book came back and now needs somewhere to go. */
  onShelve: (book: BookRow) => void
  onClose: () => void
}

interface Done {
  title: string
  note: string
}

/**
 * Work through a stack of books with the camera instead of the keyboard.
 *
 * Checking out is the whole job: read the barcode, mark it off the shelf,
 * stay open for the next one. A pile of books can be cleared without touching
 * the screen between them, which is the point.
 *
 * Checking in is not, because a book coming back has to go somewhere, and
 * only the person holding it knows whether it fits. So a successful check-in
 * hands straight over to the shelving step rather than staying here.
 */
export function ShelfCamera({ mode, onShelve, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('')
  const [good, setGood] = useState(false)
  const [done, setDone] = useState<Done[]>([])
  const [choices, setChoices] = useState<CoverMatch[]>([])

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      try {
        let stream = await openCamera(rememberedLens())
        if (!rememberedLens()) {
          const lenses = await listLenses()
          const pick = preferredLens(lenses)
          if (pick && lenses.length > 1) {
            stopStream(stream)
            rememberLens(pick)
            stream = await openCamera(pick)
          }
        }
        if (cancelled) {
          stopStream(stream)
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          void video.play().catch(() => {})
        }
        void applyFocusHints(stream, true)
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message)
      }
    }

    void start()
    return () => {
      cancelled = true
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [])

  const shoot = async () => {
    const video = videoRef.current
    if (!video || reading) return

    const image = captureStill(video)
    if (!image) {
      setError('The camera has not produced a frame yet. Give it a moment.')
      return
    }

    setReading(true)
    setMessage('')
    setGood(false)
    setChoices([])
    try {
      const result = await api.scanCheckout(image, mode === 'out')

      switch (result.outcome) {
        case 'candidates':
          // Recognised by its cover, which is a good guess and not a fact, so
          // it is offered rather than applied.
          setChoices(result.candidates)
          setMessage('No barcode. Is it one of these?')
          break

        case 'no-isbn':
          setMessage(
            result.barcodes.length
              ? 'Read a barcode, but it is not an ISBN. Try the printed number.'
              : 'No ISBN in that shot. Fill the frame with the barcode.',
          )
          break

        case 'not-catalogued':
          setMessage(`${result.isbn13} is not in the library yet. Scan it in first.`)
          break

        case 'already-out':
          setMessage(`${result.book.title} was already off the shelf.`)
          break

        case 'already-in':
          setMessage(`${result.book.title} is already on the shelf.`)
          break

        case 'checked-out':
          setGood(true)
          setMessage(`${result.book.title} is off the shelf.`)
          setDone((list) => [
            { title: result.book.title, note: result.book.author_filing },
            ...list,
          ])
          break

        case 'checked-in':
          // Handed on rather than reported: it needs a place on the shelf,
          // and that is a conversation this screen cannot have.
          onShelve(result.book)
          return
      }
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setReading(false)
    }
  }

  /** The person picked one of the look-alikes, so now it is a fact. */
  const choose = async (match: CoverMatch) => {
    setChoices([])
    setReading(true)
    try {
      const result = await api.setCheckedOut(match.id, mode === 'out')
      if (mode === 'in') {
        onShelve(result.book)
        return
      }
      // A tap on a candidate that is already off the shelf is a no-op at the
      // store: the tally only grows, and the message only claims success, for
      // a checkout that actually happened just now.
      const justCheckedOut = result.outcome === 'checked-out'
      setGood(justCheckedOut)
      setMessage(
        justCheckedOut
          ? `${match.title} is off the shelf.`
          : `${match.title} was already off the shelf.`,
      )
      if (justCheckedOut) {
        setDone((list) => [{ title: match.title, note: match.authorFiling }, ...list])
      }
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setReading(false)
    }
  }

  const taking = mode === 'out'

  return (
    <div className="isbncam">
      <video ref={videoRef} className="isbncam__video" playsInline muted autoPlay />

      <div className="isbncam__frame" aria-hidden="true" />

      <div className="isbncam__top">
        <span className="isbncam__mode">
          {taking ? 'Taking books off the shelf' : 'Putting a book back'}
        </span>
        {done.length > 0 && (
          <span className="isbncam__tally">{done.length} done</span>
        )}
      </div>

      {/* Only while taking books off. Checking in leaves for the shelving
          step on the first success, so a list here would never grow. */}
      {taking && done.length > 0 && (
        <ul className="isbncam__done">
          {done.slice(0, 4).map((entry, i) => (
            <li key={i}>
              <strong>{entry.title}</strong>
              {entry.note ? ` · ${entry.note}` : ''}
            </li>
          ))}
        </ul>
      )}

      {choices.length > 0 && (
        <div className="isbncam__choices">
          {choices.map((match) => (
            <button
              key={match.id}
              className="choice"
              onClick={() => choose(match)}
              disabled={reading}
            >
              {match.cover
                ? <img src={coverUrl(match.cover)} alt="" loading="lazy" />
                : <span className="choice__nocover">no photo</span>}
              <span className="choice__text">
                <span className="choice__title">{match.title}</span>
                <span className="choice__author">{match.authorFiling}</span>
                {/* Said out loud, so an unfamiliar cover design reads as a
                    different printing rather than as a wrong match. */}
                {match.fromCatalogue && (
                  <span className="choice__note">catalogue image, not your photo</span>
                )}
                {match.checkedOut && <span className="choice__state">already off the shelf</span>}
              </span>
            </button>
          ))}
          <button className="btn btn--ghost" onClick={() => setChoices([])}>
            None of these
          </button>
        </div>
      )}

      <div className="isbncam__bar">
        <p className={good ? 'isbncam__hint isbncam__hint--good' : 'isbncam__hint'}>
          {error || message
            || (taking
              ? 'Show the barcode, or just the front. Keep going for as many as you like.'
              : 'Show the barcode, or just the front. Putting it back leads to shelving.')}
        </p>
        <div className="isbncam__controls">
          <button className="btn" onClick={onClose} disabled={reading}>Done</button>
          <button
            className="btn btn--primary"
            onClick={shoot}
            disabled={reading || Boolean(error)}
          >
            {reading ? 'Reading...' : taking ? 'Take it off' : 'Put it back'}
          </button>
        </div>
      </div>
    </div>
  )
}
