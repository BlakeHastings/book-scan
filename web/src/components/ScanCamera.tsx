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
 *
 * ## What #408 changed here, and what it did not
 *
 * The chrome, and only the chrome. This screen is drawn by `Viewfinder` now,
 * the same component the gallery draws `#/design/inhand` with and the same one
 * the cataloguing camera has used since #316, so the picture is the whole
 * screen and every control floats on it.
 *
 * **Nothing about taking a photograph moved.** `shoot` is the same function
 * against the same burst, the stream is opened by the same effect with the
 * same lens pinning and the same focus hints, the same single thumbnail is
 * started and dropped on the floor unless a shortlist comes back, and
 * `app/cameraSession.tsx` was not edited at all. The shutter is still one
 * `onClick` straight to `shoot`, with nothing in front of it: see #294 for what
 * work put behind other work costs.
 *
 * What changed is what floats on the picture. The bottom bar of a hint and two
 * buttons is the design system's bar: a round shutter in the corner a thumb
 * reaches, the way out beside it, and the way back in the far corner. The
 * standing sentence under the old bar is gone, because the drawing settled
 * that: this camera keeps nothing, so it has no rail of photographs to say
 * what it is pointed at, and the six words that replace them float at the top
 * instead of costing a band of viewfinder for the whole sitting.
 *
 * ## This camera is not the other one, and three things say so
 *
 * **Place**: it is reached from the first screen's own door and from the find
 * screen's corner, never from the tab bar, which opens the camera that
 * catalogues. **Word**: "Hold a book up" at the top where the other one has a
 * rail of three photographs, "Done" rather than "Done with this book" on the
 * way out, and a shutter named "Find this book" where the other one's is named
 * "Take the photograph". **Glyph**: the doors that reach it carry `IconInHand`
 * and the tab that reaches the other carries `IconCamera`. #355 is what
 * confusing the two costs.
 */
export function ScanCamera({ onIdentified, onWaiting, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('')
  const [choices, setChoices] = useState<CoverMatch[]>([])
  /**
   * Which edge the near cluster is on, read once on the way in.
   *
   * Not asked here. `design/Camera.tsx` says a switch pressed once ever
   * belongs beside the rest of the settings, the settings screen asks it since
   * #350, and this camera has no sheet of its own to hang a second copy off.
   * So it reads the answer somebody already gave and the shutter lands under
   * the same thumb it does on the other camera.
   */
  const [hand] = useState<Hand>(rememberedHand)
  /**
   * Captures already waiting to be shelved that look like this book.
   *
   * Its own panel rather than rows on the shortlist, because it is a
   * different answer: not "which of these books is it" but "this has already
   * been scanned, and here is the job somebody started". See the server's
   * `alreadyInQueue`, and `QUEUE_LIMIT` for why the bar is so much tighter.
   */
  const [waiting, setWaiting] = useState<QueueMatch[]>([])
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
    setWaiting([])
    setShot('')
  }

  // The camera view fills the screen, so the document behind it must not
  // scroll or iOS will rubber-band the whole page under the controls. It came
  // free from a fixed overlay before #408 and is asked for here, the same way
  // the cataloguing camera asks for it.
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

    // Same burst as the cataloguing camera. A cover held up one-handed shakes
    // just as much, and here a blurred frame costs a wrong shortlist rather
    // than a visibly bad photo, so it is the harder failure to notice.
    const { image } = await captureSteadiest(video)
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

        case 'in-queue': {
          /*
           * Already scanned by somebody, and not shelved yet.
           *
           * Never opened without a tap, however near the match is. The
           * shortlist may open a book unasked because landing on a book's
           * page writes nothing and shows the cover immediately; a capture is
           * an unfinished job somebody else may be holding, opening it claims
           * it, and the person here has not yet been told the answer they
           * came for. So this is shown and waited on.
           */
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
        /* Nothing is kept, so there is no rail of what was kept. The drawing
           makes the same call and says why. */
        shots={[]}
        hand={hand}
        picture={
          <video ref={videoRef} className="wf-view__video" playsInline muted autoPlay />
        }
        /* Six words, in the app's own, floating rather than in a bar. Without
           the rail there is nothing else on this screen that says what it is
           for, and with the rail there is nothing else needed. */
        top={<span className="wf-view__chip">Hold a book up</span>}
        /*
         * Nothing in the far corner, where the drawing stands a handedness
         * switch in for a settings screen that now exists. The cataloguing
         * camera puts its lens list and diagnostics there because it owns the
         * session those belong to; this one opens a stream, reads one frame
         * and closes it, and has never had a sheet.
         */
        far={<></>}
        onLeave={onClose}
        onDone={onClose}
        done="Done"
        shutterName="Find this book"
        onShutter={() => void shoot()}
        /*
         * The shutter waits on nothing, and these two are not work put in
         * front of it: `reading` is the request this shutter already started,
         * and an error here is the stream having failed to open, which is
         * there being nothing to photograph. Unchanged from before #408.
         */
        shutterOff={reading || Boolean(error)}
        over={
          <>
            {error && <div className="cam__error">{error}</div>}

            {/* What the last shot came to, when it came to something that is
                neither a book nor a list. One line above the bar, the same
                place the cataloguing camera says what is in your hands. */}
            {message && !error && (
              <p className="wf-view__found wf-view__found--wide">{message}</p>
            )}

            {/* The panel is shared with the Add flow, which asks the same
                question from the other end (#146). One wording, one set of
                affordances, and it is drawn exactly as it was: the gallery has
                no drawing of it, so this is not the change to invent one in. */}
            <QueuedAlready
              matches={waiting}
              shot={shot}
              note="Open it rather than photographing it again."
              onOpen={(match) => onWaiting(match.capture)}
              onDismiss={clearChoices}
              dismissLabel="Not this one, it is a different book"
              disabled={reading}
            />

            {/*
              The shortlist a cover match produces, which the gallery does not
              draw (#387).

              No wireframe screen has an answer floating over a live picture,
              so where this sits is still the app's, exactly as `QueuedAlready`
              beside it is: `.isbncam__choices` is an offset and a height and
              nothing else now, and `Viewfinder`'s `over` slot exists to be
              handed panels like this one. Everything inside it is the design
              system's, and it is deliberately the same arrangement the queued
              panel wears, because the two answer the same question from
              opposite ends and a person meets them in the same place.

              What went with the old paint is the sticky head. The frame stays
              at the top of the panel rather than pinned inside a scrolling
              list, which is what the panel next to it already does, and one
              arrangement drawn twice is the whole reason either of them is a
              `Card`.
            */}
            {choices.length > 0 && (
              <div className="isbncam__choices">
                <Card
                  title="Which of these is it?"
                  kind="Closest first"
                  foot={
                    /* The way past the answer, in the place the panel beside
                       this one puts its own. A shortlist with no way out of it
                       is a shortlist somebody escapes by photographing the book
                       again. */
                    <Button tone="quiet" block onPress={clearChoices}>
                      None of these
                    </Button>
                  }
                >
                  {/* The frame every candidate is held against, kept above
                      them: comparing against the viewfinder means comparing
                      against a memory, because the panel covers the picture. */}
                  {shot
                    ? <img className="queued__shot" src={shot} alt="The shot these are answering" />
                    : <span className="queued__shot queued__shot--waiting">your shot</span>}
                  {/*
                    Said once, above the list, rather than on every row that
                    needs it. Each row ends in a word, which is what a row's
                    end is for; the sentence explaining what one of those words
                    means is a sentence, and thirty characters of it at the end
                    of a row pushed the title into an ellipsis. Found by
                    looking at it.
                  */}
                  <Said>
                    Tapping one opens it, nothing more. A cover marked
                    &quot;catalogue image&quot; is the publisher&apos;s, not your photograph,
                    so an unfamiliar design may be a different printing.
                  </Said>

                  <List label="Books this could be">
                    {choices.map((match) => {
                      // Word and percentage together. The word carries the band
                      // at a glance; the percentage is scaled so chance itself
                      // reads as 0%, so it is honest rather than decorative.
                      //
                      // The band was a colour as well as a word, and the word
                      // is what is left. Nothing in the design system is told
                      // by a tint alone, and a shortlist ordered closest first
                      // already says which end is which by where a row sits.
                      const confidence = matchConfidence(match.distance)
                      return (
                        <Row
                          key={match.id}
                          title={match.title}
                          sub={match.authorFiling}
                          photo={match.cover ? coverUrl(match.cover) : undefined}
                          onward={false}
                          off={reading}
                          /* The label stands in for everything on the row for
                             anybody who cannot see it, so the two marks at the
                             end are in it. They were not before, and a label
                             that is short of what the row says is a row that
                             says two different things. */
                          label={[
                            `${match.title} by ${match.authorFiling}`,
                            confidenceLine(confidence),
                            match.fromCatalogue ? 'catalogue image' : '',
                            match.checkedOut ? 'checked out' : '',
                          ].filter(Boolean).join(', ')}
                          meta={
                            <>
                              <span>{confidenceLine(confidence)}</span>
                              {/* Marked, so an unfamiliar cover design reads as
                                  a different printing rather than as a wrong
                                  match. What that means is said once above. */}
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
