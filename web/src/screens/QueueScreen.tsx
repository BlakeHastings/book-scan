/** The captures waiting for somebody to work out what they are. */

import { useEffect } from 'react'
import { QueuePane } from '../components/QueuePane'
import type { TabName } from '../design/Chrome'
import { usePaper } from '../app/paper'
import { useSummary } from '../app/summary'
import { useLeaving } from '../app/leaving'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function QueueScreen() {
  const { queueReturn, setQueueReturn, queueShowing, clearQueueShowing } = useNavigation()
  const { setQueueCounts } = useSummary()
  const { leaveFor } = useLeaving()
  const { openCapture } = useOpenBook()

  usePaper()

  /*
   * Let go of it the moment it has been read. The pane takes it as the state it
   * opens on, so leaving it set would mean the next visit through the tab bar
   * opened on a filter chosen by a count somebody pressed a while ago.
   */
  useEffect(() => {
    if (queueShowing) clearQueueShowing()
  }, [queueShowing, clearQueueShowing])

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
      /* Which books the count that opened this screen was about (#436). Read
         once by the pane, which is remounted per visit, and cleared here so
         the tab bar's own way in still opens the whole queue. */
      showing={queueShowing}
    />
  )
}
