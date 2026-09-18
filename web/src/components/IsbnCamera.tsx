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
 * Falls back to reading the printed number as text when no barcode is in
 * shot: the books this gets used on are often ones whose barcode will not
 * scan, and older books may have no barcode printed at all. The result fills
 * the field rather than submitting it, since OCR can misread a digit and a
 * wrong ISBN would silently fetch a different book. Named Cancel and "Read
 * the ISBN" rather than the other cameras' words, and keeps no rail of
 * photographs, since this only answers one field rather than acting as a
 * camera in its own right.
 */
export function IsbnCamera({ onRead, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [miss, setMiss] = useState('')
  /** Read once, and asked for on the settings screen. See `ScanCamera`. */
  const [hand] = useState<Hand>(rememberedHand)

  // Fills the screen, so the page underneath must not scroll while this is open.
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
          // The virtual multi-lens device can swap lens mid-shot, which is
          // fatal when you are holding a page still and close.
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

  // Fixed, because this camera is opened from a screen rather than routed
  // to: it arrives through the same slot a dialog does and has to leave that
  // screen the way a dialog does.
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
        shutterOff={reading || Boolean(error)}
        said={miss && !error ? <p className="wf-view__found">{miss}</p> : undefined}
        over={error ? <div className="cam__error">{error}</div> : undefined}
      />
    </div>
  )
}
