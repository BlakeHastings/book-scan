/**
 * Moving a whole run to different furniture.
 *
 * Reached from the library and only from it, because the run somebody wants to
 * move is the one they are looking at.
 *
 * Both ways out go back through the library's own return anchor, which is what
 * puts it back on the run this screen was about. Landing on Fiction after
 * moving non-fiction shows an empty needs-attention list and reads as the apply
 * having done nothing.
 */

import { MoveRunView } from '../components/MoveRunView'
import { useNavigation } from '../app/navigation'

export function ArrangeScreen() {
  const { arranging, openLibraryOn } = useNavigation()

  return (
    <MoveRunView
      range={arranging}
      onBack={() => openLibraryOn(arranging)}
      onLibrary={() => openLibraryOn(arranging)}
    />
  )
}
