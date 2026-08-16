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
  const { openScanner, setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const { choose } = useArmful()
  const [work, setWork] = useState<CarryWork | null>(null)
  usePaper()

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
      onHome={() => setRoute('home')}
      onLibrary={() => setRoute('library')}
      onQueue={() => setRoute('queue')}
      onScan={openScanner}
    />
  )
}
