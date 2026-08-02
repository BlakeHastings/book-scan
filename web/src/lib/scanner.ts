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

/**
 * Shooting order: back first.
 *
 * The back cover carries the barcode and the printed ISBN, so shooting it
 * first means identification starts on shot one and the lookup runs while the
 * remaining photos are being taken, instead of the user waiting at the end.
 */
export const SLOTS: Slot[] = ['back', 'front', 'edge']

export const SLOT_LABEL: Record<Slot, string> = {
  back: 'Back cover',
  front: 'Front cover',
  edge: 'Spine',
}

export const SLOT_SHORT: Record<Slot, string> = {
  back: 'Back',
  front: 'Front',
  edge: 'Spine',
}

export const SLOT_HINT: Record<Slot, string> = {
  back: 'The barcode and printed ISBN. Shot first so the lookup starts now.',
  front: 'The cover. Used for the title if no ISBN turns up.',
  edge: 'The spine, as it will look on the shelf.',
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
 * A crop expressed as fractions of the *displayed* video box.
 *
 * The on-screen guide and the real crop are both driven from this one value,
 * so they cannot drift apart.
 */
export interface CropFraction {
  x: number
  y: number
  width: number
  height: number
}

/** Tall, narrow, centred: the shape of a book spine held up to the camera. */
export const SPINE_CROP: CropFraction = {
  width: 0.24,
  height: 0.80,
  x: (1 - 0.24) / 2,
  y: (1 - 0.80) / 2,
}

export const SLOT_CROP: Partial<Record<Slot, CropFraction>> = {
  edge: SPINE_CROP,
}

/**
 * Translate a crop given in displayed-box fractions into source pixels.
 *
 * The video is rendered with `object-fit: cover`, which scales to fill and
 * clips the overflow, so displayed coordinates are not source coordinates.
 * Getting this wrong puts the saved crop somewhere other than the rectangle
 * the user framed, which is worse than no crop at all.
 */
export function cropToSource(
  video: HTMLVideoElement,
  crop: CropFraction,
): { sx: number; sy: number; sw: number; sh: number } {
  const videoWidth = video.videoWidth
  const videoHeight = video.videoHeight
  const boxWidth = video.clientWidth || videoWidth
  const boxHeight = video.clientHeight || videoHeight

  // object-fit: cover scales by the larger ratio, then centres and clips.
  const scale = Math.max(boxWidth / videoWidth, boxHeight / videoHeight)
  const overflowX = (videoWidth * scale - boxWidth) / 2
  const overflowY = (videoHeight * scale - boxHeight) / 2

  const sx = (crop.x * boxWidth + overflowX) / scale
  const sy = (crop.y * boxHeight + overflowY) / scale
  const sw = (crop.width * boxWidth) / scale
  const sh = (crop.height * boxHeight) / scale

  // Clamp so a rounding error never asks the canvas for pixels off the frame.
  const clampedX = Math.max(0, Math.min(sx, videoWidth))
  const clampedY = Math.max(0, Math.min(sy, videoHeight))
  return {
    sx: clampedX,
    sy: clampedY,
    sw: Math.max(1, Math.min(sw, videoWidth - clampedX)),
    sh: Math.max(1, Math.min(sh, videoHeight - clampedY)),
  }
}

export interface CaptureOptions {
  maxWidth?: number
  /** Omit for the full frame. */
  crop?: CropFraction
}

/**
 * Grab the current frame as a JPEG data URL.
 *
 * Kept large and lightly compressed: this image goes to a barcode decoder and
 * an OCR pass, and both lose accuracy fast on a downscaled or blocky source.
 * It travels as base64 inside a JSON body, hence the ceiling.
 */
export function captureStill(
  video: HTMLVideoElement,
  options: CaptureOptions = {},
): string {
  if (!video.videoWidth || !video.videoHeight) return ''

  const { maxWidth = 2400, crop } = options
  const { sx, sy, sw, sh } = crop
    ? cropToSource(video, crop)
    : { sx: 0, sy: 0, sw: video.videoWidth, sh: video.videoHeight }

  const scale = Math.min(1, maxWidth / sw)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)

  const context = canvas.getContext('2d')
  if (!context) return ''
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

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
