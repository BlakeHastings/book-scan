/**
 * Both reads are of the world as it now is rather than of anything this flow was holding: the
 * armful is only asked how many books went down and where, which is the one thing the ledger
 * cannot say on its own.
 */

import { useEffect, useState } from 'react'
import { CarriedPane } from '../components/CarriedPane'
import { api, type CarryWork, type StandingBook } from '../lib/api'
import { useArmful } from '../app/armful'
import { useErrorBanner } from '../app/errorBanner'
import { useNavigation } from '../app/navigation'
import { usePaper } from '../app/paper'

export function CarriedScreen() {
  const { openScanner, setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const { trip, done, choose, putBack } = useArmful()
  const [board, setBoard] = useState<StandingBook[] | null>(null)
  const [work, setWork] = useState<CarryWork | null>(null)
  usePaper()

  useEffect(() => {
    if (!trip) { setRoute('carry'); return undefined }

    let live = true
    // The area named twice means the area on its own: everything standing on it now, with nothing going anywhere. See `tripAtArea`.
    api.carryTrip(trip.toAreaId, trip.toAreaId)
      .then((at) => { if (live) setBoard(at.books) })
      .catch((caught) => { if (live) setError((caught as Error).message) })
    api.carry()
      .then((answer) => { if (live) setWork(answer) })
      .catch(() => {})
    return () => { live = false }
  }, [trip, setError, setRoute])

  if (!trip) return null

  return (
    <CarriedPane
      placed={done}
      to={trip.to}
      board={board}
      work={work}
      onTrip={(next) => { choose(next); setRoute('trip') }}
      onHome={() => { putBack(); setRoute('home') }}
      onQueue={() => { putBack(); setRoute('queue') }}
      onScan={() => { putBack(); openScanner() }}
    />
  )
}
