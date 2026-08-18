/**
 * The scanner: a full-screen camera that reads an ISBN off a book already in
 * the collection and opens it.
 *
 * It is the whole screen, and the page that opened it is not behind it: the
 * route table draws one screen and this is it, so leaving here is a route
 * change back to wherever `leaveScanner` says. It said "above everything else"
 * until #408 and that was true of a fixed overlay this camera has not been
 * since the route table was built.
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
   * A book the scanner recognised. It gets opened and nothing else.
   *
   * This is the whole of what scanning does. The detail view reads the book's
   * checked-out state and offers the actions that fit it, so the same landing
   * works for a book on the shelf and one in a pile on the table, and the
   * person picks. Starting a check-in here because the book happens to be out
   * was the original idea and is deferred until identification is measurably
   * better than it is (#49).
   *
   * The scanner is left first and the book is fetched after, which is what
   * closing it used to do when it was a flag beside the mode rather than a
   * route. It means the home screen is on show for the length of one request,
   * and it means a book that fails to load leaves you on a screen that can
   * draw the error. Preserved rather than endorsed: tightening it is a change
   * to what a screen shows, and this refactor is not allowed to make one.
   */
  const openScanned = async (id: number) => {
    setRoute('home')
    await openBook(id, 'scan')
  }

  /**
   * A book the scanner recognised as one already in the queue (#122).
   *
   * Opening the capture somebody made, rather than starting a second one.
   * That is the whole value of the answer: the photographs already exist and
   * have already been read, so a second capture adds nothing but a duplicate
   * row for somebody to notice later, and noticing is the step that fails.
   * Two rows of the same book end either as the same book catalogued twice or
   * as a discard that takes the photographs of the real one with it.
   *
   * Claimed on the way in, through the same call the queue makes, because the
   * thing that stops two people filling in one book is the claim and not which
   * screen they arrived from. A capture still being read cannot be opened at
   * all, for the same reason the queue refuses: there is nothing yet to
   * confirm or correct.
   */
  const openWaiting = async (capture: Capture) => {
    if (!canShelve(capture)) {
      setToast('Still reading its photographs. Give it a moment and open it from the queue.')
      return
    }
    try {
      const { capture: claimed } = await api.claimCapture(capture.id, deviceName())
      // The index is where to land if this capture leaves the queue while it
      // is open, and the scanner never saw the list it would be an index into.
      // The top of the queue is the honest answer to "near where it was".
      openCapture(claimed, { id: capture.id, index: 0 })
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  return (
    <ScanCamera
      onIdentified={(id) => void openScanned(id)}
      onWaiting={(capture) => void openWaiting(capture)}
      /* Back to whichever screen opened it (#350), which used to be the first
         screen whatever you had come from. Its main door is the corner of the
         find screen now, and dropping somebody two screens away from the
         search they were part way through is throwing that search out. */
      onClose={leaveScanner}
    />
  )
}
