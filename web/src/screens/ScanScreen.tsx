/**
 * The scanner: a full-screen camera that reads an ISBN off a book already in the collection
 * and opens it. It is the whole screen and the page that opened it is not behind it: leaving
 * here is a route change back to wherever `leaveScanner` says.
 */

import { canShelve } from '../components/QueuePane'
import { ScanCamera } from '../components/ScanCamera'
import { deviceName, api, type Capture } from '../lib/api'
import { useCameraSession } from '../app/cameraSession'
import { useErrorBanner } from '../app/errorBanner'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function ScanScreen() {
  const { leaveScanner, setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const { setToast } = useCameraSession()
  const { openBook, openCapture } = useOpenBook()

  /**
   * The detail view reads the book's checked-out state and offers the actions that fit it, so
   * the same landing works for a book on the shelf and one in a pile on the table.
   *
   * The scanner is left first and the book is fetched after, so the home screen is on show for
   * the length of one request and a book that fails to load leaves you on a screen that can
   * draw the error.
   */
  const openScanned = async (id: number) => {
    setRoute('home')
    await openBook(id, 'scan')
  }

  /**
   * Claimed on the way in, through the same call the queue makes, since it is the claim rather
   * than which screen somebody arrived from that stops two people filling in one book. A capture
   * still being read cannot be opened, for the same reason the queue refuses: there is nothing
   * yet to confirm or correct.
   */
  const openWaiting = async (capture: Capture) => {
    if (!canShelve(capture)) {
      setToast('Still reading its photographs. Give it a moment and open it from the queue.')
      return
    }
    try {
      const { capture: claimed } = await api.claimCapture(capture.id, deviceName())
      // Index 0: the scanner never saw the queue list this would otherwise be an index into.
      openCapture(claimed, { id: capture.id, index: 0 })
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  return (
    <ScanCamera
      onIdentified={(id) => void openScanned(id)}
      onWaiting={(capture) => void openWaiting(capture)}
      onClose={leaveScanner}
    />
  )
}
