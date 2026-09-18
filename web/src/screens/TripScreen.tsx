/**
 * The area is asked for fresh, since the list that led here may have been drawn a while ago.
 * The moment somebody says they have the books it stops being asked: the armful and both ends
 * of the walk are fixed from then until it is empty, so the screen is never re-answered
 * underneath them.
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
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  usePaper()

  useEffect(() => {
    if (!trip) { setRoute('carry'); return undefined }

    let live = true
    api.carryTrip(trip.fromAreaId, trip.toAreaId)
      .then((answer) => { if (live) setAt(answer) })
      .catch((caught) => { if (live) setError((caught as Error).message) })

    // Asked separately because the trip that got here carries no opinion about the rest of the list.
    api.carry()
      .then((work) => { if (live) setOnly(work.trips.length === 1) })
      .catch(() => {})

    return () => { live = false }
  }, [trip, setError, setRoute])

  /** Back to the list rather than staying here: redrawing the same area with nothing marked on it would be a screen about nothing. */
  const leave = () => {
    if (!trip) return
    setBusy(true)
    api.carryLeave({ from: trip.fromAreaId, to: trip.toAreaId })
      .then(() => setRoute('carry'))
      .catch((caught) => setError((caught as Error).message))
      .finally(() => { setBusy(false); setAsking(false) })
  }

  return (
    <TripPane
      trip={at}
      only={only && at?.books.filter((book) => book.going).length === 1}
      onTake={(books) => { pickUp(books); setRoute('carrying') }}
      asking={asking}
      onAsk={() => setAsking(true)}
      onKeep={() => setAsking(false)}
      onLeave={leave}
      busy={busy}
      onBack={() => setRoute(only ? 'home' : 'carry')}
      onHome={() => setRoute('home')}
      onQueue={() => setRoute('queue')}
      onScan={openScanner}
    />
  )
}
