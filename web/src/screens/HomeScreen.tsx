import { HomePane } from '../components/HomePane'
import { useRoomMenu } from '../components/RoomMenu'
import { useBrowsing } from '../app/browsing'
import { useNavigation } from '../app/navigation'
import { usePaper } from '../app/paper'
import { useSummary } from '../app/summary'

export function HomeScreen() {
  const { setRoute, openScanner, openQueueOn } = useNavigation()
  const { openLibraryShowing } = useBrowsing()
  const {
    counts, queueCounts, carrying, unclaimed, backup, drifting, lookups, unreachable,
  } = useSummary()
  // `HomePane` holds no state, so the corner menu is opened out here and handed down as two props.
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
      drifting={drifting}
      lookups={lookups}
      unreachable={unreachable}
      onAdd={() => setRoute('capture')}
      // `openScanner` remembers where it was opened from, so giving up on it comes back here.
      onInHand={openScanner}
      corner={room.action}
      menu={room.sheet}
      /* `openLibraryShowing` sets the narrowing and the route together, so a count cannot open the right screen showing the wrong thing. */
      onLibrary={(showing) => openLibraryShowing(showing ?? null)}
      /* `openQueueOn` sets the filter and the route together, for the same reason. */
      onQueue={(showing) => (showing ? openQueueOn(showing) : setRoute('queue'))}
      onCarry={() => setRoute('carry')}
      onUnclaimed={() => setRoute('unclaimed')}
    />
  )
}
