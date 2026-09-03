/**
 * Everything still to be carried, as the trips it is made of.
 *
 * **The work is asked for again every time this screen opens**, which is what
 * makes stopping halfway free: there is no plan and nothing stored, so the list
 * is simply what is left. A book somebody carried has taken itself off it, and a
 * rule changed five minutes ago is already in it.
 *
 * ## One book skips this screen
 *
 * A list of one trip so it can be tapped is a tap for nothing, so a single book
 * lands on the area it comes off instead. Same journey, two screens shorter.
 * Done here rather than in the pane because it is a decision about where to be,
 * not about what to draw.
 */

import { useEffect, useState } from 'react'
import { CarryPane } from '../components/CarryPane'
import { api, type CarryWork } from '../lib/api'
import { useArmful } from '../app/armful'
import { useErrorBanner } from '../app/errorBanner'
import { useNavigation } from '../app/navigation'
import { usePaper } from '../app/paper'

export function CarryScreen() {
  const { openScanner, openRoom, setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const { choose } = useArmful()
  const [work, setWork] = useState<CarryWork | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  usePaper()

  /**
   * Leave the work where it is, or ask for it back, and redraw from the answer.
   *
   * **The list comes back from the server rather than being adjusted here.**
   * Both routes answer with the whole of it, recomputed, which is the same
   * contract every write in this app has: a screen that subtracted its own
   * number would be a screen with an opinion about the ledger.
   */
  const decide = (about: () => Promise<{ work: CarryWork }>) => {
    setBusy(true)
    about()
      .then((answer) => setWork(answer.work))
      .catch((caught) => setError((caught as Error).message))
      .finally(() => {
        setBusy(false)
        /*
         * The question closes when the answer has been carried out and not when
         * it was pressed, so nobody is left looking at the old list wondering
         * whether anything happened. It closes on a failure too: the banner is
         * what says what went wrong, and a dialog still up over it would be a
         * second thing to dismiss before the message can be read.
         */
        setAsking(false)
      })
  }

  useEffect(() => {
    let live = true
    api.carry()
      .then((answer) => {
        if (!live) return
        setWork(answer)
        /*
         * Straight to the area, for a job that is one book. `choose` here rather
         * than a redirect route: the trip screen is about a trip and this is the
         * one there is.
         */
        if (answer.moving === 1 && answer.trips[0]) {
          choose(answer.trips[0])
          setRoute('trip')
        }
      })
      .catch((caught) => { if (live) setError((caught as Error).message) })
    return () => { live = false }
  }, [choose, setError, setRoute])

  return (
    <CarryPane
      work={work}
      onTrip={(trip) => { choose(trip); setRoute('trip') }}
      onChanged={() => setRoute('carrystale')}
      asking={asking}
      onAsk={() => setAsking(true)}
      onKeep={() => setAsking(false)}
      onLeave={() => decide(() => api.carryLeave())}
      onRestore={() => decide(() => api.carryRestore())}
      busy={busy}
      onHome={() => setRoute('home')}
      onLibrary={() => setRoute('library')}
      /* The furniture, which is what the button under an empty list says it
         shows. It was handed `setRoute('library')` through `onLibrary` and
         opened the wall of covers instead (#459). Through `openRoom` so the
         back arrow over there returns here, the way every other door to the
         furniture does since #350. */
      onFurniture={() => openRoom('furniture')}
      onQueue={() => setRoute('queue')}
      onScan={openScanner}
    />
  )
}
