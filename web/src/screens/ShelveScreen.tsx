/** Where to put the book, and the answer to whether it fitted. */

import { ShelveView } from '../components/ShelveView'
import { rangeOfSlug } from '../../domain/tagging/genre'
import { useBookActions } from '../app/bookActions'
import { useBookInHand } from '../app/bookInHand'
import { useNavigation } from '../app/navigation'

export function ShelveScreen() {
  const { setRoute } = useNavigation()
  const { draft, saving, placement, placementStale, refreshPlacement } = useBookInHand()
  const { save } = useBookActions()

  return (
    <ShelveView
      placement={placement}
      stale={placementStale}
      range={rangeOfSlug(draft.genre)}
      title={draft.title || 'this book'}
      saving={saving}
      onShelved={(shelvedAt) => save(shelvedAt)}
      onBack={() => setRoute('review')}
      onRefresh={refreshPlacement}
    />
  )
}
