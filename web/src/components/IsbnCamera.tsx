import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
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
 */
export function IsbnCamera({ onRead, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [miss, setMiss] = useState('')

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

  return (
    <div className="isbncam">
      <video ref={videoRef} className="isbncam__video" playsInline muted autoPlay />

      <div className="isbncam__frame" aria-hidden="true" />

      <div className="isbncam__bar">
        <p className="isbncam__hint">
          {error || miss || 'Point at the barcode or the printed ISBN and fill the frame.'}
        </p>
        <div className="isbncam__controls">
          <button className="btn" onClick={onCancel} disabled={reading}>Cancel</button>
          <button className="btn btn--primary" onClick={shoot} disabled={reading || Boolean(error)}>
            {reading ? 'Reading...' : 'Read ISBN'}
          </button>
        </div>
      </div>
    </div>
  )
}
