/**
 * The first screen: what there is, and what is waiting to be done to it.
 *
 * The first one drawn with the design system (#303), and the reason it has no
 * `chrome` in the route table: it brings its own top bar and four-place tab
 * bar, and the app's header would be a second bar above them saying the same
 * thing.
 */

import { HomePane } from '../components/HomePane'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { usePaper } from '../app/paper'
import { useSummary } from '../app/summary'

export function HomeScreen() {
  const { setRoute } = useNavigation()
  const { counts, queueCounts, queued, carrying } = useSummary()
  const { openCapture } = useOpenBook()

  // The page under a converted screen takes the design system's paper. See
  // `app/paper.ts`, which is these three lines with a name on them.
  usePaper()

  return (
    <HomePane
      counts={counts}
      queue={queueCounts}
      queued={queued}
      carrying={carrying}
      onAdd={() => setRoute('capture')}
      onScan={() => setRoute('scan')}
      onLibrary={() => setRoute('library')}
      onQueue={() => setRoute('queue')}
      onCarry={() => setRoute('carry')}
      /*
       * Straight into the book, the way the queue opens one. The anchor is
       * where to land in the queue listing on the way back, and coming from
       * here there is no position to keep: the top of the queue is the
       * honest answer, which is the same one every other screen gives where
       * it has to invent one.
       */
      onOpenReady={(capture) => openCapture(capture, { id: capture.id, index: 0 })}
    />
  )
}
