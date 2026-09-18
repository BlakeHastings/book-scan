/**
 * The work is asked for again every time this screen opens: there is no plan and nothing
 * stored, so the list is simply what is left. A single book skips this screen and lands on
 * the area it comes off instead, since a list of one trip is a tap for nothing.
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

  /** The list comes back from the server rather than being adjusted here: both routes answer with the whole of it, recomputed. */
  const decide = (about: () => Promise<{ work: CarryWork }>) => {
    setBusy(true)
    about()
      .then((answer) => setWork(answer.work))
      .catch((caught) => setError((caught as Error).message))
      .finally(() => {
        setBusy(false)
        // Closes on a failure too: the banner says what went wrong, and a dialog still up over it would be a second thing to dismiss.
        setAsking(false)
      })
  }

  useEffect(() => {
    let live = true
    api.carry()
      .then((answer) => {
        if (!live) return
        setWork(answer)
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
      // Through `openRoom`, not `setRoute`, so the back arrow over there returns here.
      onFurniture={() => openRoom('furniture')}
      onQueue={() => setRoute('queue')}
      onScan={openScanner}
    />
  )
}
