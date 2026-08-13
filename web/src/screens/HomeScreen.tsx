/**
 * The first screen: what there is, and what is waiting to be done to it.
 *
 * The first one drawn with the design system (#303), and the reason it has no
 * `chrome` in the route table: it brings its own top bar and four-place tab
 * bar, and the app's header would be a second bar above them saying the same
 * thing.
 */

import { useEffect } from 'react'
import { HomePane } from '../components/HomePane'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { useSummary } from '../app/summary'

export function HomeScreen() {
  const { setRoute } = useNavigation()
  const { counts, queueCounts, queued, carrying } = useSummary()
  const { openCapture } = useOpenBook()

  /*
   * The page under the converted screen takes the design system's paper. See
   * `body.wf-page` in design/library.css: the app paints `html, body` a cold
   * dark blue-grey, which otherwise shows either side of the 480px column and
   * under an overscroll bounce.
   */
  useEffect(() => {
    document.body.classList.add('wf-page')
    return () => document.body.classList.remove('wf-page')
  }, [])

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
