/** The captures waiting for somebody to work out what they are. */

import { QueuePane } from '../components/QueuePane'
import type { TabName } from '../design/Chrome'
import { usePaper } from '../app/paper'
import { useSummary } from '../app/summary'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function QueueScreen() {
  const { queueReturn, setQueueReturn } = useNavigation()
  const { setQueueCounts } = useSummary()
  const { leaveFor } = useLeaving()
  const { openCapture } = useOpenBook()

  usePaper()

  const tabs: Record<TabName, () => void> = {
    home: () => leaveFor('home'),
    library: () => leaveFor('library'),
    scan: () => leaveFor('capture'),
    queue: () => {},
  }

  return (
    <QueuePane
      onOpen={openCapture}
      onCounts={setQueueCounts}
      tabs={tabs}
      onPhotograph={() => leaveFor('capture')}
      returnAnchor={queueReturn}
      onReturnAnchorConsumed={() => setQueueReturn(null)}
    />
  )
}
