import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Viewfinder, type Hand } from '../design/Camera'
import { rememberedHand } from '../lib/hand'
import {
  applyFocusHints, captureStill, listLenses, openCamera, preferredLens,
  rememberedLens, rememberLens, stopStream,
} from '../lib/scanner'

interface Props {
  onRead: (isbn: string, source: 'barcode' | 'ocr') => void
  onCancel: () => void
}

/**
 * Point the camera at an ISBN rather than copying it digit by digit.
 *
 * Reads a barcode if one is in shot and falls back to reading the printed
 * number as text, which is the case that matters: the books this gets used on
 * are the ones whose barcode would not scan, and plenty of older books have an
 * ISBN printed on the copyright page with no barcode anywhere.
 *
 * The result fills the field rather than submitting it. OCR misreads digits,
 * and a wrong ISBN silently fetches a different book, so a person still gets
 * to look at the number before it is used.
 *
 * ## What #408 changed here, and what it did not
 *
 * The chrome, and only the chrome. It is `Viewfinder` now, the frame both the
 * other cameras wear, so the picture is the whole screen. **Nothing about
 * taking a photograph moved**: the same single still rather than a burst,
 * because an ISBN is read from a page held still and close and the burst buys
 * nothing there; the same lens pinning, for the reason the comment below
 * gives; the same near-focus hints; the same one call to `identifyIsbn`,
 * straight off the shutter with nothing in front of it.
 *
 * ## It is not either of the two cameras, and does not pretend to be
 *
 * It is a way of answering one field, opened from that field and handing an
 * answer back to it, which is why it is the only one of the three whose way
 * out is called Cancel and whose shutter is named for digits rather than for a
 * book. It keeps nothing, so like the camera that finds a book in your hand it
 * draws no rail of photographs.
 */
export function IsbnCamera({ onRead, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [miss, setMiss] = useState('')
  /** Read once, and asked for on the settings screen. See `ScanCamera`. */
  const [hand] = useState<Hand>(rememberedHand)

  // Fills the screen, so the page under it must not scroll. It came free from
  // a fixed overlay before #408 and is asked for here.
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
          // Same reason as the main camera: the virtual multi-lens device
          // swaps lens mid-shot, which is fatal when you are holding a page
          // still and close.
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
        // An ISBN is read from close up, so ask for the near-focus hints.
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
    setMiss('')
    try {
      const result = await api.identifyIsbn(image)
      if (result.isbn13) {
        onRead(result.isbn13, result.source === 'barcode' ? 'barcode' : 'ocr')
        return
      }
      setMiss(
        result.barcodes.length
          ? 'Found a barcode, but it is not an ISBN. Try the printed number instead.'
          : 'No ISBN in that shot. Move closer, and keep the number in focus.',
      )
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setReading(false)
    }
  }

  /*
   * Fixed, because this camera is opened from a screen rather than routed to.
   * The other two are the whole page already; this one arrives through the
   * same slot a dialog does and has to leave that screen the way a dialog
   * does.
   */
  return (
    <div className="wf wf-screen wf-screen--camera wf-screen--over">
      <Viewfinder
        /* Nothing is kept: the answer is thirteen digits and the frame goes. */
        shots={[]}
        hand={hand}
        picture={
          <video ref={videoRef} className="wf-view__video" playsInline muted autoPlay />
        }
        top={<span className="wf-view__chip">Point at the ISBN</span>}
        /* Nothing in the far corner, for the reason `ScanCamera` gives. */
        far={<></>}
        onLeave={onCancel}
        onDone={onCancel}
        done="Cancel"
        shutterName="Read the ISBN"
        onShutter={() => void shoot()}
        /* Unchanged from before #408: the request this shutter started, and a
           stream that never opened. Nothing else is ever in front of it. */
        shutterOff={reading || Boolean(error)}
        over={
          <>
            {error && <div className="cam__error">{error}</div>}
            {miss && !error && (
              <p className="wf-view__found wf-view__found--wide">{miss}</p>
            )}
          </>
        }
      />
    </div>
  )
}
