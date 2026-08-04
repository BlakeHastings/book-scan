import { useEffect, useRef, useState } from 'react'
import { api, type CoverMatch } from '../lib/api'
import { coverUrl } from './PlacementCard'
import { confidentPick, matchConfidence, shortlistPrompt } from '../lib/confidence'
import {
  applyFocusHints, captureStill, listLenses, openCamera, preferredLens,
  rememberedLens, rememberLens, stopStream, thumbnail,
} from '../lib/scanner'

interface Props {
  /** Which book is being held up. Opening it is all that follows. */
  onIdentified: (bookId: number) => void
  onClose: () => void
}

/**
 * Hold a book up and find out which one it is.
 *
 * One camera, not two. There used to be a check-out camera and a check-in
 * camera, and picking between them meant deciding what you were about to do
 * before you had picked the book up. Now there is Scan: it works out which
 * book is in your hands and opens it, and the book's own page offers the
 * actions that make sense for the state it is actually in.
 *
 * Nothing on this screen writes to the catalogue. It cannot: the only call it
 * makes reads a photograph and answers with an identity. Choosing the action
 * from the book's state, so a checked-out book checks itself back in on sight,
 * was considered and deferred (#49): the cover matcher still puts the wrong
 * book first about one lookup in ten, and that is not a rate to act on
 * unattended against a catalogue nobody can rebuild.
 */
export function ScanCamera({ onIdentified, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('')
  const [choices, setChoices] = useState<CoverMatch[]>([])
  /**
   * The shot the shortlist is answering, shrunk to a thumbnail.
   *
   * One frame, never a history. Comparing a candidate against the live
   * viewfinder means comparing it against memory, because the panel covers
   * most of the picture and the book has moved by then. So the frame that
   * was actually hashed stays on screen beside the candidates, and goes the
   * moment the panel does.
   */
  const [shot, setShot] = useState('')

  /** Drop the shortlist and the frame together. Neither outlives the other. */
  const clearChoices = () => {
    setChoices([])
    setShot('')
  }

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

    // Started now, kept only if a shortlist comes back. Every other outcome
    // lets it fall on the floor, so the full frame is never held twice.
    const shrunk = thumbnail(image)

    setReading(true)
    setMessage('')
    clearChoices()
    try {
      const result = await api.scanBook(image)

      switch (result.outcome) {
        case 'identified':
          // A barcode named a row in the catalogue. Nothing to confirm.
          onIdentified(result.book.id)
          return

        case 'candidates': {
          // Recognised by its cover, which is a guess and not a fact. One
          // candidate in the close band is a good enough guess to open a page
          // on, since opening a page writes nothing and puts the cover and
          // title straight in front of the person. Anything else is a list.
          const sure = confidentPick(result.candidates)
          if (sure) {
            onIdentified(sure.id)
            return
          }
          setChoices(result.candidates)
          setShot(await shrunk)
          setMessage(shortlistPrompt(result.candidates))
          break
        }

        case 'no-isbn':
          setMessage(
            result.barcodes.length
              ? 'Read a barcode, but it is not an ISBN. Try the printed number.'
              : 'Nothing recognised in that shot. Fill the frame with the cover.',
          )
          break

        case 'not-catalogued':
          setMessage(`${result.isbn13} is not in the library yet. Add it first.`)
          break
      }
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="isbncam">
      <video ref={videoRef} className="isbncam__video" playsInline muted autoPlay />

      <div className="isbncam__frame" aria-hidden="true" />

      <div className="isbncam__top">
        <span className="isbncam__mode">Hold a book up to the camera</span>
      </div>

      {choices.length > 0 && (
        <div className="isbncam__choices">
          {/* Stays put while the list scrolls, so every candidate can be held
              against the same picture rather than against a recollection. */}
          <div className="choices__head">
            {shot
              ? <img className="choices__shot" src={shot} alt="The shot these are answering" />
              : <span className="choice__nocover">your shot</span>}
            <span className="choice__text">
              <span className="choice__title">Your shot</span>
              <span className="choice__author">
                Closest first. Tapping one opens it, nothing more.
              </span>
            </span>
          </div>

          {choices.map((match) => {
            // Words and weight, never the number. A distance of 2 and one of
            // 24 both mean "in the shortlist"; only this says which is which.
            const confidence = matchConfidence(match.distance)
            return (
              <button
                key={match.id}
                className={`choice choice--${confidence.strength}`}
                onClick={() => onIdentified(match.id)}
                disabled={reading}
                aria-label={`${match.title} by ${match.authorFiling}, ${confidence.label}`}
              >
                {match.cover
                  ? <img src={coverUrl(match.cover)} alt="" loading="lazy" />
                  : <span className="choice__nocover">no photo</span>}
                <span className="choice__text">
                  <span className="choice__title">{match.title}</span>
                  <span className="choice__author">{match.authorFiling}</span>
                  <span className={`choice__confidence choice__confidence--${confidence.strength}`}>
                    {confidence.label}
                  </span>
                  {/* Said out loud, so an unfamiliar cover design reads as a
                      different printing rather than as a wrong match. */}
                  {match.fromCatalogue && (
                    <span className="choice__note">catalogue image, not your photo</span>
                  )}
                  {match.checkedOut && <span className="choice__state">already off the bookcase</span>}
                </span>
              </button>
            )
          })}
          <button className="btn btn--ghost" onClick={clearChoices}>
            None of these
          </button>
        </div>
      )}

      <div className="isbncam__bar">
        <p className="isbncam__hint">
          {error || message
            || 'Show the barcode, or just the front. It opens the book and you choose.'}
        </p>
        <div className="isbncam__controls">
          <button className="btn" onClick={onClose} disabled={reading}>Done</button>
          <button
            className="btn btn--primary"
            onClick={shoot}
            disabled={reading || Boolean(error)}
          >
            {reading ? 'Reading...' : 'Scan'}
          </button>
        </div>
      </div>
    </div>
  )
}
