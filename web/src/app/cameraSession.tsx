/**
 * The camera, moved as one piece and given the lifetime it already had.
 *
 * ## Read this before shortening it
 *
 * This is the part of the app that took real work to get right on real
 * phones: a live media stream, a lens pinned so the phone stops swapping
 * mid-shot, a torch that follows the spine, and a diagnostics sheet that
 * exists because nobody working on this owns the phone (#92). A silent
 * regression here is a book photographed badly by somebody standing at a
 * bookcase, found a week later.
 *
 * So this provider wraps the whole app rather than the camera screen, and
 * that is deliberate. In the single component this came out of, every one of
 * these values outlived the camera screen: leaving the viewfinder for review
 * and coming back left the lens list, the last burst's report and the focus
 * note exactly where they were. Scoping them to the screen would have
 * discarded them on unmount, which is a change to what the settings sheet
 * shows, and this issue is not allowed to change what a screen shows.
 *
 * **The stream itself is unaffected either way**, and that is worth saying
 * plainly: every exit from the camera screen already calls `stopCamera`
 * explicitly, the torch effect turns the light off in its cleanup, and the
 * unmount teardown below fires exactly when it fired before, at the app's
 * unmount. Nothing about when a track is opened or stopped has moved.
 *
 * Whether the session *should* be screen-scoped is a fair question and it is
 * not this issue's to answer. It is one provider in one file now, so it is a
 * question somebody can answer on its own.
 *
 * Only `useBookInHand().activeSlot` is read from outside: the focus hints and
 * the torch both follow the slot, because the spine is shot closest and is the
 * one that wants light.
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import {
  applyFocusHints, cameraFacts, describeStream, listLenses, openCamera,
  preferredLens, rememberedLens, rememberLens, rememberedTorch,
  setTorch, stopStream, torchAvailable,
  SLOT_HINT, type CameraFact, type Lens,
} from '../lib/scanner'
import { useBookInHand } from './bookInHand'
import { useErrorBanner } from './errorBanner'

export interface CameraSession {
  readonly videoRef: React.RefObject<HTMLVideoElement>
  readonly streamRef: React.MutableRefObject<MediaStream | null>
  readonly cameraOn: boolean
  readonly resolution: string
  readonly lenses: Lens[]
  readonly lensId: string
  readonly focusNote: string
  readonly settingsOpen: boolean
  readonly setSettingsOpen: Dispatch<SetStateAction<boolean>>
  /**
   * The torch, offered only where the phone actually has one and only on the
   * spine, which is the shot that needs it. More light means a shorter
   * exposure means less blur, which is the one lever on steadiness that is
   * physical rather than statistical.
   */
  readonly torchReady: boolean
  readonly torchOn: boolean
  readonly setTorchOn: Dispatch<SetStateAction<boolean>>
  /** What the last burst did, read off the phone to settle whether it is worth it. */
  readonly burstNote: string
  readonly setBurstNote: Dispatch<SetStateAction<string>>
  readonly facts: CameraFact[]
  readonly factsCopied: boolean
  readonly setFactsCopied: Dispatch<SetStateAction<boolean>>
  readonly toast: string
  readonly setToast: Dispatch<SetStateAction<string>>
  readonly startCamera: (preferred?: string) => Promise<void>
  readonly stopCamera: () => void
  readonly switchLens: (deviceId: string) => Promise<void>
}

const Context = createContext<CameraSession | null>(null)

export function CameraSessionProvider({ children }: { children: ReactNode }) {
  const { activeSlot } = useBookInHand()
  const { setError } = useErrorBanner()

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraOn, setCameraOn] = useState(false)
  const [resolution, setResolution] = useState('')
  const [lenses, setLenses] = useState<Lens[]>([])
  const [lensId, setLensId] = useState(rememberedLens())
  const [focusNote, setFocusNote] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [torchReady, setTorchReady] = useState(false)
  const [torchOn, setTorchOn] = useState(rememberedTorch())
  const [burstNote, setBurstNote] = useState('')
  const [facts, setFacts] = useState<CameraFact[]>([])
  const [factsCopied, setFactsCopied] = useState(false)
  const [toast, setToast] = useState('')

  const stopCamera = useCallback(() => {
    stopStream(streamRef.current)
    streamRef.current = null
    setCameraOn(false)
    setResolution('')
  }, [])

  // The last thing the page does. Same teardown as before this was its own
  // file: it fires when the app goes away, not when the camera screen does.
  useEffect(() => stopCamera, [stopCamera])

  // getUserMedia needs a user gesture on iOS, so this only runs from a tap.
  const startCamera = async (preferred = lensId) => {
    setError('')
    try {
      const stream = await openCamera(preferred)
      streamRef.current = stream
      setCameraOn(true)
      setResolution(describeStream(stream))

      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        // Deliberately not awaited: a stream that never delivers a frame
        // leaves this pending forever, and the lens work below must not be
        // held up by it.
        void video.play().catch(() => {})
      }

      // Lens labels stay blank until permission is granted, so the list can
      // only be read once a stream is actually open.
      const found = await listLenses()
      setLenses(found)
      if (!preferred && found.length > 1) {
        const pick = preferredLens(found)
        // Reopen pinned to one physical lens, so the phone stops swapping
        // between wide and ultra-wide while a book is being lined up.
        if (pick) {
          stopStream(stream)
          setLensId(pick)
          rememberLens(pick)
          void startCamera(pick)
          return
        }
      }

      setFocusNote((await applyFocusHints(stream, activeSlot === 'edge')).join(', '))
      setTorchReady(torchAvailable(stream))
    } catch (caught) {
      setError((caught as Error).message)
      stopCamera()
    }
  }

  const switchLens = async (deviceId: string) => {
    setLensId(deviceId)
    rememberLens(deviceId)
    stopCamera()
    await startCamera(deviceId)
  }

  // The spine is shot closest, so re-apply the hints when that slot is picked.
  useEffect(() => {
    if (!cameraOn) return
    void applyFocusHints(streamRef.current, activeSlot === 'edge')
      .then((applied) => setFocusNote(applied.join(', ')))
  }, [activeSlot, cameraOn])

  /**
   * Light the spine, and only the spine.
   *
   * Following the slot rather than being a mode of its own means no extra tap:
   * the person picks the spine as they already do, and the light is on when
   * they get there. It goes out again on the covers, which are shot flat and
   * do not need it, and where a torch would only bounce off the artwork.
   */
  useEffect(() => {
    if (!cameraOn || !torchReady) return
    const wanted = torchOn && activeSlot === 'edge'
    void setTorch(streamRef.current, wanted)
    // Off on the way out, so closing the camera never leaves a phone lit up in
    // somebody's pocket.
    return () => { void setTorch(streamRef.current, false) }
  }, [activeSlot, cameraOn, torchOn, torchReady])

  // Read once the sheet is opened rather than on every render: getCapabilities
  // is a synchronous call into the capture device and this is a viewfinder.
  useEffect(() => {
    if (!settingsOpen) return
    setFacts(cameraFacts(streamRef.current, videoRef.current))
    setFactsCopied(false)
  }, [settingsOpen])

  // Say what this slot wants, then get out of the way. A hint that lives on
  // screen permanently stops being read and only costs you viewfinder.
  useEffect(() => {
    if (!cameraOn) {
      setToast('')
      return
    }
    setToast(SLOT_HINT[activeSlot])
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [activeSlot, cameraOn])

  return (
    <Context.Provider
      value={{
        videoRef, streamRef,
        cameraOn, resolution, lenses, lensId, focusNote,
        settingsOpen, setSettingsOpen,
        torchReady, torchOn, setTorchOn,
        burstNote, setBurstNote,
        facts, factsCopied, setFactsCopied,
        toast, setToast,
        startCamera,
        stopCamera,
        switchLens,
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useCameraSession(): CameraSession {
  const found = useContext(Context)
  if (!found) throw new Error('useCameraSession was called outside CameraSessionProvider')
  return found
}
