/**
 * One trip, read at the area the books come off.
 *
 * The area is asked for fresh, because the list that led here may have been
 * drawn a while ago and the answer is recomputed rather than remembered. **The
 * moment somebody says they have the books, it stops being asked**: the armful
 * and both ends of the walk are fixed from then until it is empty, so the screen
 * naming an area for the book in a person's hand is never re-answered underneath
 * them.
 */

import { useEffect, useState } from 'react'
import { TripPane } from '../components/TripPane'
import { api, type TripAtAnArea } from '../lib/api'
import { useArmful } from '../app/armful'
import { useErrorBanner } from '../app/errorBanner'
import { useNavigation } from '../app/navigation'
import { usePaper } from '../app/paper'

export function TripScreen() {
  const { openScanner, setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const { trip, pickUp } = useArmful()
  const [at, setAt] = useState<TripAtAnArea | null>(null)
  const [only, setOnly] = useState(false)
  usePaper()

  useEffect(() => {
    if (!trip) { setRoute('carry'); return undefined }

    let live = true
    api.carryTrip(trip.fromAreaId, trip.toAreaId)
      .then((answer) => { if (live) setAt(answer) })
      .catch((caught) => { if (live) setError((caught as Error).message) })

    /*
     * Whether this trip is the whole of the work, which decides what the bar
     * says and where the way back goes. Asked separately because the trip that
     * got here carries no opinion about the rest of the list.
     */
    api.carry()
      .then((work) => { if (live) setOnly(work.trips.length === 1) })
      .catch(() => {})

    return () => { live = false }
  }, [trip, setError, setRoute])

  return (
    <TripPane
      trip={at}
      only={only && at?.books.filter((book) => book.going).length === 1}
      onTake={(books) => { pickUp(books); setRoute('carrying') }}
      onBack={() => setRoute(only ? 'home' : 'carry')}
      onHome={() => setRoute('home')}
      onQueue={() => setRoute('queue')}
      onScan={openScanner}
    />
  )
}
