/** The captures waiting for somebody to work out what they are. */

import { QueuePane } from '../components/QueuePane'
import { useSummary } from '../app/summary'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function QueueScreen() {
  const { queueReturn, setQueueReturn } = useNavigation()
  const { setQueueCounts } = useSummary()
  const { openCapture } = useOpenBook()

  return (
    <QueuePane
      onOpen={openCapture}
      onCounts={setQueueCounts}
      returnAnchor={queueReturn}
      onReturnAnchorConsumed={() => setQueueReturn(null)}
    />
  )
}
