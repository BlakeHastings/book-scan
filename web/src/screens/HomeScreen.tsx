/**
 * The first screen: what there is, and what is waiting to be done to it.
 *
 * The first one drawn with the design system (#303), and the reason it has no
 * `chrome` in the route table: it brings its own top bar and four-place tab
 * bar, and the app's header would be a second bar above them saying the same
 * thing.
 */

import { HomePane } from '../components/HomePane'
import { useRoomMenu } from '../components/RoomMenu'
import { useNavigation } from '../app/navigation'
import { usePaper } from '../app/paper'
import { useSummary } from '../app/summary'

export function HomeScreen() {
  const { setRoute, openScanner, openQueueOn } = useNavigation()
  const { counts, queueCounts, carrying, unclaimed, backup } = useSummary()
  /*
   * The corner, and the sheet it opens (#350). `HomePane` holds no state, so
   * the menu is opened out here and handed down as two props.
   */
  const room = useRoomMenu()

  // The page under a converted screen takes the design system's paper. See
  // `app/paper.ts`, which is these three lines with a name on them.
  usePaper()

  return (
    <HomePane
      counts={counts}
      queue={queueCounts}
      carrying={carrying}
      unclaimed={unclaimed}
      backup={backup}
      onAdd={() => setRoute('capture')}
      /*
       * The other camera (#355), through the one way in there is: `openScanner`
       * remembers where it was opened from, so giving up on it comes back here
       * rather than to whichever screen it used to land on. `setRoute('scan')`
       * written out here would be the fifth caller that forgot to.
       */
      onInHand={openScanner}
      corner={room.action}
      menu={room.sheet}
      onLibrary={() => setRoute('library')}
      /* The queue, on the books the press was about (#436). `openQueueOn` sets
         the filter and the route together, so a count cannot open the right
         screen showing the wrong thing; with nothing named it is the whole
         queue, which is what the tab bar asks for. */
      onQueue={(showing) => (showing ? openQueueOn(showing) : setRoute('queue'))}
      onCarry={() => setRoute('carry')}
      onUnclaimed={() => setRoute('unclaimed')}
    />
  )
}
