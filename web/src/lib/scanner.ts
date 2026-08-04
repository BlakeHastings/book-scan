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
  edge: 'The spine, as it will look on the bookcase.',
}

export interface Lens {
  deviceId: string
  label: string
}

const LENS_KEY = 'bookscan.lens'

/** The lens last chosen, so it survives a reload rather than re-picking. */
export function rememberedLens(): string {
  return localStorage.getItem(LENS_KEY) ?? ''
}

export function rememberLens(deviceId: string): void {
  if (deviceId) localStorage.setItem(LENS_KEY, deviceId)
  else localStorage.removeItem(LENS_KEY)
}

/**
 * The rear lenses this phone will name.
 *
 * Labels are empty until camera permission has been granted, so this is only
 * worth calling once a stream is open.
 */
export async function listLenses(): Promise<Lens[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'videoinput')
      .filter((d) => !/front/i.test(d.label))
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Camera' }))
  } catch {
    return []
  }
}

/**
 * The address this page is actually loaded from.
 *
 * Vite prints eight of these at startup (localhost, lvh.me, and four LAN
 * interfaces including Docker and WSL ranges), and only some of them are
 * reachable from a phone. Both the camera permission and the self-signed
 * certificate exception are scoped to the exact origin, so a phone that once
 * loaded a different one is not the same origin as far as either is
 * concerned, even though it looks like the same app.
 */
export function currentOrigin(): string {
  if (typeof location === 'undefined') return 'this address'
  return `${location.protocol}//${location.host}`
}

export type CameraFailureReason =
  | 'insecure-context'
  | 'permission-denied'
  | 'no-camera'
  | 'unsupported'
  | 'unknown'

export interface CameraDiagnosis {
  reason: CameraFailureReason
  message: string
}

/**
 * Why the camera did not open, in words a person can act on.
 *
 * "No camera devices" on its own is a dead end: it reads the same whether the
 * fix is in Settings or the device genuinely has no camera. This is #60: a
 * second phone had a stale permission denial and a stale certificate
 * exception, both scoped to one of the eight addresses Vite prints, and the
 * app had no way to say which of those was true.
 *
 * `navigator.permissions.query` only reads the browser's stored decision, it
 * does not request anything, so it is safe to call at any time, including
 * before a user gesture. It is also not supported everywhere (notably not
 * for `camera` on every engine), so a browser that lacks it falls back to
 * reading the error name alone, which still separates permission denial from
 * a genuinely missing camera.
 */
export async function diagnoseCameraFailure(error?: unknown): Promise<CameraDiagnosis> {
  const origin = currentOrigin()

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return {
      reason: 'insecure-context',
      message:
        `${origin} is not a secure address, and the browser refuses camera ` +
        'access on plain HTTP. Use the https address instead, which is why ' +
        'the dev server hands out a self-signed certificate.',
    }
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      reason: 'unsupported',
      message: 'This browser does not expose a camera at all, on any address.',
    }
  }

  let permissionState: PermissionState | undefined
  try {
    const status = await navigator.permissions?.query?.({ name: 'camera' as PermissionName })
    permissionState = status?.state
  } catch {
    // Not every engine supports querying the camera permission. Fall through
    // to the error name, which is still informative on its own.
    permissionState = undefined
  }

  const name = (error as DOMException | undefined)?.name

  if (permissionState === 'denied' || name === 'NotAllowedError') {
    return {
      reason: 'permission-denied',
      message:
        `Camera permission was denied for ${origin}. Open the "aA" menu in ` +
        'the address bar, choose Website Settings, and set Camera to Allow. ' +
        'If that setting is not offered, the fix is clearing this site: ' +
        'Settings, Safari, Advanced, Website Data, find this address, ' +
        'remove it, then reload.',
    }
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      reason: 'no-camera',
      message:
        permissionState === 'granted'
          ? `Permission is granted for ${origin}, but this browser found no ` +
            'camera to use. That points at the device, not this app.'
          : `No camera was found at ${origin}. If this device has one, a ` +
            'blocked permission can look the same as no camera; check the ' +
            '"aA" menu, Website Settings, Camera.',
    }
  }

  return {
    reason: 'unknown',
    message: (error as Error)?.message || `The camera could not be opened at ${origin}.`,
  }
}

/** "Back Ultra Wide Camera" is too long for a chip; "Ultra Wide" is not. */
export function lensName(label: string): string {
  const short = label.replace(/\bback\b/i, '').replace(/\bcamera\b/i, '').trim()
  return short || 'Main'
}

const VIRTUAL_LENS = /dual|triple|combined/i
const ULTRA_WIDE_LENS = /ultra.?wide/i
const TELEPHOTO_LENS = /tele/i

/**
 * Prefer a single physical lens over the combined one.
 *
 * An iPhone offers a virtual "Back Dual/Triple Camera" alongside the real
 * lenses, and that virtual device is what silently switches lens mid-shot as
 * the phone guesses at the subject distance. Asking for the plain back camera
 * pins it, so the framing stops jumping while you are lining a book up.
 *
 * That reason still holds, and it is now known to cost nothing in steadiness.
 * WebKit's capture source never asks AVFoundation for video stabilisation on
 * any device, and the multi-frame fusion the virtual device can do is a still
 * photo setting that a getUserMedia video track never reaches. Stabilisation
 * on an iPhone is optical, and it lives on the physical wide lens, which is
 * precisely the one this pins. Pinning gives up lens switching, not steadiness.
 *
 * The order below matters, and only its tail changed (#92). "Back Camera" is
 * the wide lens and has optical stabilisation on every iPhone that has any, so
 * it wins outright. What follows is for phones that do not label a lens that
 * way, and it used to be "the first thing that is not virtual", which on an
 * iPhone can be the ultra wide. That is the worst rear lens for this job on
 * two counts: no stabilisation at all on non-Pro models, and a field of view
 * so wide that a spine lands on a fraction of the pixels it otherwise would,
 * in a crop that is already down to a few hundred pixels across. So a virtual
 * device now outranks it: a virtual device sits on the wide lens by default,
 * and an occasional framing jump is a smaller price than a permanently softer,
 * smaller subject. Ultra wide is the last resort rather than an early guess.
 */
export function preferredLens(lenses: Lens[]): string {
  const rank = (lens: Lens): number => {
    const label = lens.label.trim()
    if (/back camera$/i.test(label)) return 0
    if (ULTRA_WIDE_LENS.test(label)) return 4
    if (VIRTUAL_LENS.test(label)) return 2
    if (TELEPHOTO_LENS.test(label)) return 3
    return 1
  }

  // Strictly better only, so equal ranks keep the order the browser gave.
  let best: Lens | undefined
  for (const lens of lenses) {
    if (!best || rank(lens) < rank(best)) best = lens
  }
  return best?.deviceId ?? ''
}

/**
 * Ask for the back camera at the highest resolution Safari will give us.
 * These are hints, so an older phone degrades rather than failing.
 */
export async function openCamera(deviceId = ''): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const diagnosis = await diagnoseCameraFailure()
    throw new Error(diagnosis.message)
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // exact pins the lens. Without it the phone is free to swap between
        // wide and ultra-wide mid-session, which moves the framing under you.
        ...(deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: 'environment' } }),
        // Ask high. Safari clamps to the nearest supported mode, and the
        // still is only ever as good as the track we are drawing from.
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    })
  } catch (error) {
    const diagnosis = await diagnoseCameraFailure(error)
    throw new Error(diagnosis.message)
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

/**
 * Tall, narrow, centred: the shape of a book spine held up to the camera.
 *
 * Height is 0.68 rather than the full frame so the whole rectangle sits in
 * clear screen between the top bar and the shutter row. This one really does
 * discard what falls outside it, so a boundary you cannot see is a boundary
 * you will get wrong.
 */
export const SPINE_CROP: CropFraction = {
  width: 0.24,
  height: 0.68,
  x: (1 - 0.24) / 2,
  y: 0.10,
}

/**
 * Which slots are actually cropped on capture.
 *
 * Only the spine. Cropping a front or back cover would be actively harmful:
 * the printed ISBN often sits close to an edge, and a crop that clips its last
 * character costs the check digit and makes the whole number unusable. That
 * exact failure has already happened here once. The full frame is kept for
 * front and back, and their guides are alignment aids only.
 */
export const SLOT_CROP: Partial<Record<Slot, CropFraction>> = {
  edge: SPINE_CROP,
}

/**
 * Roughly the proportions of a paperback held up to a phone in portrait.
 *
 * Sat above centre on purpose: the controls occupy the lower fifth of the
 * screen, and a vertically centred rectangle runs underneath them. Safe to
 * position for legibility precisely because this one does not crop anything.
 */
const BOOK_GUIDE: CropFraction = {
  width: 0.82,
  height: 0.60,
  x: (1 - 0.82) / 2,
  y: 0.11,
}

/**
 * The rectangle drawn on the live preview for each slot.
 *
 * For the spine this is the crop, so what is framed is exactly what is saved.
 * For front and back it is guidance only: line the book up the same way every
 * time and the library thumbnails stay comparable, without risking the ISBN.
 */
export const SLOT_GUIDE: Record<Slot, CropFraction> = {
  back: BOOK_GUIDE,
  front: BOOK_GUIDE,
  edge: SPINE_CROP,
}

/**
 * A word, not a sentence. It sits inside the frame, where a spine guide is
 * only a couple of centimetres wide, and the toast already explains the slot.
 */
export const SLOT_GUIDE_LABEL: Record<Slot, string> = {
  back: 'Back',
  front: 'Front',
  edge: 'Spine',
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

/**
 * Nudge the camera towards the subject in the middle of the frame.
 *
 * Everything here is feature-detected and optional, because the browser that
 * matters supports almost none of it. iOS Safari exposes no way to *set* focus:
 * WebKit's capture source understands width, height, aspectRatio, frameRate,
 * facingMode, deviceId, groupId, focusDistance, whiteBalanceMode, zoom and
 * torch, and of those only whiteBalanceMode, zoom and torch are ever applied to
 * the device. There is no focusMode and no tap-to-focus hook. focusDistance is
 * reported but read only, as the lens minimum, which `cameraFacts` surfaces
 * rather than sets. So this helps on Android and is nearly a no-op on an
 * iPhone, and the honest fix for a spine that will not come sharp is distance,
 * not code. Returns what it actually managed to apply, so the UI can say
 * rather than imply.
 */
export async function applyFocusHints(
  stream: MediaStream | null,
  close: boolean,
): Promise<string[]> {
  const track = stream?.getVideoTracks()[0]
  if (!track?.getCapabilities) return []

  let capabilities: MediaTrackCapabilities
  try {
    capabilities = track.getCapabilities()
  } catch {
    return []
  }

  const applied: string[] = []
  const wanted: Record<string, unknown> = {}
  const supported = capabilities as Record<string, unknown>

  const focusModes = supported.focusMode as string[] | undefined
  if (Array.isArray(focusModes) && focusModes.includes('continuous')) {
    wanted.focusMode = 'continuous'
    applied.push('continuous focus')
  }

  // A little optical zoom pushes the camera to meter and focus on the middle
  // of the frame rather than whatever is nearest, which is usually a hand.
  const zoom = supported.zoom as { min?: number; max?: number } | undefined
  if (close && zoom && typeof zoom.max === 'number' && typeof zoom.min === 'number') {
    const target = Math.min(zoom.max, Math.max(zoom.min, zoom.min * 1.8))
    if (target > zoom.min) {
      wanted.zoom = target
      applied.push(`zoom ${target.toFixed(1)}x`)
    }
  }

  if (!Object.keys(wanted).length) return []

  try {
    await track.applyConstraints({ advanced: [wanted] } as MediaTrackConstraints)
    return applied
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// What this camera actually is
// ---------------------------------------------------------------------------

/** Read a track's capabilities without caring that some browsers have none. */
function capabilitiesOf(stream: MediaStream | null): Record<string, unknown> {
  const track = stream?.getVideoTracks()[0]
  if (!track?.getCapabilities) return {}
  try {
    return (track.getCapabilities() as unknown as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

export interface CameraFact {
  /** Plain enough to read down a telephone. */
  label: string
  value: string
}

/**
 * What the camera actually granted, in words a non-developer can report back.
 *
 * This exists because the remaining open questions about steadying a shot
 * cannot be answered without the phone (#92), and the person holding that
 * phone is not going to open a web inspector. Each line is one of those
 * questions: whether the resolution we ask for is the resolution we get, how
 * fast frames arrive (which sets the exposure ceiling and so the burst
 * length), whether a torch is offered at all, and how close the pinned lens
 * can focus, which is the difference between "hold the book further away" and
 * "this lens cannot do it".
 *
 * The spine strip is the one that reframes the whole problem: the spine crop
 * is a narrow slice of an already-cropped frame, so it arrives at the OCR only
 * a few hundred pixels across. That is why the spine is the hardest shot. It
 * is not that hands shake more on it, it is that it has the fewest pixels to
 * lose, so it is worth being able to read the real number off the real phone.
 */
export function cameraFacts(
  stream: MediaStream | null,
  video?: HTMLVideoElement | null,
): CameraFact[] {
  const track = stream?.getVideoTracks()[0]
  if (!track) return [{ label: 'Camera', value: 'not running' }]

  const settings = (track.getSettings?.() ?? {}) as MediaTrackSettings
  const capabilities = capabilitiesOf(stream)
  const facts: CameraFact[] = []

  facts.push({ label: 'Lens in use', value: track.label || 'unnamed' })

  facts.push({
    label: 'Picture size',
    value: settings.width && settings.height
      ? `${settings.width} by ${settings.height}`
      : 'not reported',
  })

  facts.push({
    label: 'Frames a second',
    value: settings.frameRate ? `${Math.round(settings.frameRate)}` : 'not reported',
  })

  facts.push({
    label: 'Torch',
    value: capabilities.torch === true ? 'available' : 'not offered by this phone',
  })

  const focus = capabilities.focusDistance as { min?: number } | undefined
  facts.push({
    label: 'Closest it can focus',
    value: typeof focus?.min === 'number'
      // Reported in metres. Centimetres is what somebody holding a book thinks in.
      ? `${Math.round(focus.min * 100)} cm`
      : 'not reported',
  })

  const zoom = capabilities.zoom as { min?: number; max?: number } | undefined
  facts.push({
    label: 'Zoom range',
    value: typeof zoom?.min === 'number' && typeof zoom?.max === 'number'
      ? `${zoom.min}x to ${zoom.max}x`
      : 'not adjustable',
  })

  if (video?.videoWidth) {
    const { sw } = cropToSource(video, SPINE_CROP)
    facts.push({ label: 'Spine strip', value: `${Math.round(sw)} pixels across` })
  }

  return facts
}

/** The same facts as one pasteable block, so they can be sent rather than read out. */
export function cameraFactsText(facts: CameraFact[]): string {
  return facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')
}
