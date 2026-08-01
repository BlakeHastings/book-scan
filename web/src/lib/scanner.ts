/**
 * Camera and barcode decoding, written for Safari on iOS.
 *
 * Three Safari facts drive the shape of this file:
 *   1. There is no BarcodeDetector, so decoding goes through ZXing.
 *   2. There is no ImageCapture, so a still is a canvas draw of the video
 *      frame rather than a real photo. Requesting a high-resolution track is
 *      therefore the only lever on still quality.
 *   3. getUserMedia needs a user gesture and the video element needs both
 *      `playsinline` and `muted`, or playback silently never starts.
 */

import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { pickIsbn } from '../../shared/isbn'

export interface ScannerControls {
  stop(): void
}

/**
 * Ask for the back camera at 1080p. Safari treats these as hints and returns
 * the nearest mode it has, so this degrades rather than failing.
 */
export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'This browser will not expose a camera. On iPhone the page must be ' +
        'served over HTTPS, which is why the dev server uses a self-signed ' +
        'certificate.',
    )
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    })
  } catch (error) {
    const name = (error as DOMException)?.name
    if (name === 'NotAllowedError') {
      throw new Error(
        'Camera permission was denied. On iPhone, reload and tap Allow, or ' +
          'check Settings, Safari, Camera.',
      )
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('No usable camera was found on this device.')
    }
    throw error
  }
}

/**
 * Attach the stream and start decoding EAN-13 only. Restricting the format
 * matters: it is markedly faster per frame, and it stops ZXing reporting the
 * EAN-5 price add-on that sits next to the ISBN on most back covers.
 *
 * `onIsbn` only fires for real Bookland (978/979) codes that pass their check
 * digit, so a price barcode never reaches the lookup.
 */
export async function startDecoding(
  stream: MediaStream,
  video: HTMLVideoElement,
  onIsbn: (isbn: string) => void,
): Promise<ScannerControls> {
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13])
  hints.set(DecodeHintType.TRY_HARDER, true)

  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 120,
  })

  let lastSeen = ''
  let lastSeenAt = 0

  const controls = await reader.decodeFromStream(stream, video, (result) => {
    if (!result) return

    const isbn = pickIsbn([result.getText()])
    if (!isbn) return

    // The same book stays in frame for many frames. Debounce so one physical
    // book triggers one lookup.
    const now = Date.now()
    if (isbn === lastSeen && now - lastSeenAt < 4000) return
    lastSeen = isbn
    lastSeenAt = now

    onIsbn(isbn)
  })

  return { stop: () => controls.stop() }
}

/**
 * Grab the current frame as a JPEG data URL.
 *
 * Capped at `maxWidth` because the payload travels as base64 inside a JSON
 * body. 1600px keeps a cover legible while staying well under the server's
 * body limit.
 */
export function captureStill(video: HTMLVideoElement, maxWidth = 1600): string {
  const sourceWidth = video.videoWidth
  const sourceHeight = video.videoHeight
  if (!sourceWidth || !sourceHeight) return ''

  const scale = Math.min(1, maxWidth / sourceWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sourceWidth * scale)
  canvas.height = Math.round(sourceHeight * scale)

  const context = canvas.getContext('2d')
  if (!context) return ''
  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  return canvas.toDataURL('image/jpeg', 0.85)
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** Human-readable resolution, so the user can see they really are getting HD. */
export function describeStream(stream: MediaStream | null): string {
  const track = stream?.getVideoTracks()[0]
  if (!track) return ''
  const { width, height } = track.getSettings()
  return width && height ? `${width}x${height}` : ''
}
