/**
 * What the last change of mind did to the list.
 *
 * Read fresh, like everything else here. There is no snapshot to compare
 * against: the newest run of the rules is in the ledger with its own timestamp,
 * and folding the books it touched with and without it is the difference.
 */

import { useEffect, useState } from 'react'
import { CarryStalePane } from '../components/CarryStalePane'
import { api, type CarryWork } from '../lib/api'
import { useErrorBanner } from '../app/errorBanner'
import { useNavigation } from '../app/navigation'
import { usePaper } from '../app/paper'

export function CarryStaleScreen() {
  const { setRoute } = useNavigation()
  const { setError } = useErrorBanner()
  const [work, setWork] = useState<CarryWork | null>(null)
  usePaper()

  useEffect(() => {
    let live = true
    api.carry()
      .then((answer) => { if (live) setWork(answer) })
      .catch((caught) => { if (live) setError((caught as Error).message) })
    return () => { live = false }
  }, [setError])

  return (
    <CarryStalePane
      work={work}
      onCarry={() => setRoute('carry')}
      onHome={() => setRoute('home')}
      onQueue={() => setRoute('queue')}
      onScan={() => setRoute('scan')}
    />
  )
}
