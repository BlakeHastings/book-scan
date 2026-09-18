import { useEffect, useRef, useState } from 'react'
import { api, type Capture, type CoverMatch, type QueueMatch } from '../lib/api'
import { coverUrl } from './PlacementCard'
import { QueuedAlready } from './QueuedAlready'
import { confidenceLine, confidentPick, matchConfidence, shortlistPrompt } from '../../shared/confidence'
import { Card, Said } from '../design/Card'
import { Button } from '../design/Controls'
import { List, Row } from '../design/List'
import { Viewfinder, type Hand } from '../design/Camera'
import { rememberedHand } from '../lib/hand'
import {
  applyFocusHints, listLenses, openCamera, preferredLens,
  rememberedLens, rememberLens, stopStream, thumbnail,
} from '../lib/scanner'
import { captureSteadiest } from '../lib/steady'

interface Props {
  /** Which book is being held up. Opening it is all that follows. */
  onIdentified: (bookId: number) => void
  /**
   * The book being held up is already in the queue, and this is the capture
   * somebody made of it. Opening it is all that follows here too.
   */
  onWaiting: (capture: Capture) => void
  onClose: () => void
}

/**
 * This screen never writes to the catalogue: the only call it makes reads a
 * photograph and answers with an identity. Choosing the action from the
 * book's state (so a checked-out book checks itself back in on sight) was
 * considered and deferred: the cover matcher still puts the wrong book
 * first about one lookup in ten, which is not a rate to act on unattended
 * against a catalogue nobody can rebuild.
 */
export function ScanCamera({ onIdentified, onWaiting, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('')
  const [choices, setChoices] = useState<CoverMatch[]>([])
  // Read once on the way in rather than asked here: this camera has no
  // sheet of its own, and the settings screen already asks it.
  const [hand] = useState<Hand>(rememberedHand)
  /**
   * A different answer from the shortlist ("this has already been scanned"
   * rather than "which of these is it"), so its own panel rather than rows
   * on it.
   */
  const [waiting, setWaiting] = useState<QueueMatch[]>([])
  /**
   * One frame, never a history. Comparing a candidate against the live
   * viewfinder means comparing it against memory, since the panel covers
   * most of the picture and the book has moved by then, so the frame that
   * was actually hashed stays on screen instead.
   */
  const [shot, setShot] = useState('')

  /** Drop the shortlist and the frame together. Neither outlives the other. */
  const clearChoices = () => {
    setChoices([])
    setWaiting([])
    setShot('')
  }

  // The camera view fills the screen, so the document behind it must not
  // scroll or iOS will rubber-band the whole page under the controls.
  useEffect(() => {
    document.body.classList.add('body--locked')
    return () => document.body.classList.remove('body--locked')
  }, [])

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

    // A cover held up one-handed shakes just as much as a page being
    // photographed, and here a blurred frame costs a wrong shortlist rather
    // than a visibly bad photo, so it is the harder failure to notice.
    const { image } = await captureSteadiest(video)
    if (!image) {
      setError('The camera has not produced a frame yet. Give it a moment.')
      return
    }

    // Started now, kept only if a shortlist comes back; every other outcome
    // lets it fall on the floor.
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
          // One candidate in the close band is a good enough guess to open a
          // page on, since opening a page writes nothing; anything else is a list.
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

        case 'in-queue': {
          // Never opened without a tap, unlike a confident cover match: a
          // capture is an unfinished job somebody else may be holding, and
          // opening it claims it.
          setWaiting(result.matches)
          setShot(await shrunk)
          setMessage('')
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
    <div className="wf wf-screen wf-screen--camera">
      <Viewfinder
        // Nothing is kept, so there is no rail of what was kept.
        shots={[]}
        hand={hand}
        picture={
          <video ref={videoRef} className="wf-view__video" playsInline muted autoPlay />
        }
        top={<span className="wf-view__chip">Hold a book up</span>}
        // Nothing in the far corner: the cataloguing camera puts its lens
        // list and diagnostics there because it owns the session those
        // belong to, and this one opens a stream, reads one frame and
        // closes it.
        far={<></>}
        onLeave={onClose}
        onDone={onClose}
        done="Done"
        shutterName="Find this book"
        onShutter={() => void shoot()}
        // `reading` is the request this shutter already started; an error
        // here is the stream having failed to open, which is there being
        // nothing to photograph.
        shutterOff={reading || Boolean(error)}
        said={message && !error ? <p className="wf-view__found">{message}</p> : undefined}
        over={
          <>
            {error && <div className="cam__error">{error}</div>}

            <QueuedAlready
              matches={waiting}
              shot={shot}
              note="Open it rather than photographing it again."
              onOpen={(match) => onWaiting(match.capture)}
              onDismiss={clearChoices}
              dismissLabel="Not this one, it is a different book"
              disabled={reading}
            />

            {choices.length > 0 && (
              <div className="isbncam__choices">
                <Card
                  title="Which of these is it?"
                  kind="Closest first"
                  foot={
                    // A shortlist with no way out of it is a shortlist
                    // somebody escapes by photographing the book again.
                    <Button tone="quiet" block onPress={clearChoices}>
                      None of these
                    </Button>
                  }
                >
                  {shot
                    ? <img className="queued__shot" src={shot} alt="The shot these are answering" />
                    : <span className="queued__shot queued__shot--waiting">your shot</span>}
                  <Said>
                    Tapping one opens it, nothing more. A cover marked
                    &quot;catalogue image&quot; is the publisher&apos;s, not your photograph,
                    so an unfamiliar design may be a different printing.
                  </Said>

                  <List label="Books this could be">
                    {choices.map((match) => {
                      // Percentage is scaled so chance itself reads as 0%,
                      // so it is honest rather than decorative.
                      const confidence = matchConfidence(match.distance)
                      return (
                        <Row
                          key={match.id}
                          title={match.title}
                          sub={match.authorFiling}
                          photo={match.cover ? coverUrl(match.cover) : undefined}
                          onward={false}
                          off={reading}
                          // The label stands in for the whole row for anybody
                          // who cannot see it, so both end marks are in it.
                          label={[
                            `${match.title} by ${match.authorFiling}`,
                            confidenceLine(confidence),
                            match.fromCatalogue ? 'catalogue image' : '',
                            match.checkedOut ? 'checked out' : '',
                          ].filter(Boolean).join(', ')}
                          meta={
                            <>
                              <span>{confidenceLine(confidence)}</span>
                              {match.fromCatalogue && <span>catalogue image</span>}
                              {match.checkedOut && <span>checked out</span>}
                            </>
                          }
                          onPress={() => onIdentified(match.id)}
                        />
                      )
                    })}
                  </List>
                </Card>
              </div>
            )}
          </>
        }
      />
    </div>
  )
}
