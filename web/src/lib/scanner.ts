/**
 * Camera access and manual still capture, written for Safari on iOS.
 *
 * There is no barcode decoding here any more. Live decoding in the browser
 * could not read real book barcodes: video frames are motion-blurred and
 * lower resolution than the sensor, and Safari has no BarcodeDetector so it
 * fell to ZXing on downscaled frames. The server now decodes a full-resolution
 * still with zbar plus preprocessing variants, and falls back to OCR, which is
 * what the Python version does.
 *
 * Safari constraints that shape this file:
 *   - getUserMedia needs a user gesture, so the camera starts from a tap
 *   - the video element needs `playsinline` and `muted` or playback never
 *     starts and the frame stays black
 *   - there is no ImageCapture, so a still is a canvas draw of the video
 *     frame, which makes the requested track resolution the only real lever
 *     on quality
 */

export type Slot = 'front' | 'back' | 'edge'

/** Shooting order: front, spine, back. The back comes last because it is the
 *  natural way to turn a book over in your hands. */
export const SLOTS: Slot[] = ['front', 'edge', 'back']

export const SLOT_LABEL: Record<Slot, string> = {
  front: 'Front cover',
  edge: 'Spine',
  back: 'Back cover',
}

export const SLOT_SHORT: Record<Slot, string> = {
  front: 'Front',
  edge: 'Spine',
  back: 'Back',
}

export const SLOT_HINT: Record<Slot, string> = {
  front: 'The cover. Used for the title if no ISBN turns up.',
  edge: 'The spine, as it will look on the shelf.',
  back: 'The barcode and printed ISBN. This is the one that identifies the book.',
}

/**
 * Ask for the back camera at the highest resolution Safari will give us.
 * These are hints, so an older phone degrades rather than failing.
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
        // Ask high. Safari clamps to the nearest supported mode, and the
        // still is only ever as good as the track we are drawing from.
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    })
  } catch (error) {
    const name = (error as DOMException)?.name
    if (name === 'NotAllowedError') {
      throw new Error(
        'Camera permission was denied. Reload and tap Allow, or check ' +
          'Settings, Safari, Camera.',
      )
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('No usable camera was found on this device.')
    }
    throw error
  }
}

/**
 * Grab the current frame as a JPEG data URL.
 *
 * Kept large and lightly compressed: this image is going to a barcode decoder
 * and an OCR pass, and both lose accuracy fast on a downscaled or blocky
 * source. It travels as base64 inside a JSON body, hence the ceiling.
 */
export function captureStill(video: HTMLVideoElement, maxWidth = 2400): string {
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

  return canvas.toDataURL('image/jpeg', 0.92)
}

/** Smaller copy for on-screen thumbnails, so state stays cheap to hold. */
export function thumbnail(dataUrl: string, maxWidth = 320): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxWidth / image.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      const context = canvas.getContext('2d')
      if (!context) return resolve(dataUrl)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** Human-readable resolution, so it is obvious the phone really is in HD. */
export function describeStream(stream: MediaStream | null): string {
  const track = stream?.getVideoTracks()[0]
  if (!track) return ''
  const { width, height } = track.getSettings()
  return width && height ? `${width}x${height}` : ''
}
