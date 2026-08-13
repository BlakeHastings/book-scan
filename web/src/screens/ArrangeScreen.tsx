/**
 * Moving a whole run to different furniture.
 *
 * Reached from the library and only from it, because the run somebody wants to
 * move is the one they are looking at.
 *
 * Backing out goes through the library's own return anchor, which is what puts
 * it back on the run this screen was about. Landing on Fiction after moving
 * non-fiction reads as the apply having done nothing.
 *
 * **Applying lands on the carry flow instead**, since #314 built it. Applying
 * writes down where the rules want each book and moves nothing, so the honest
 * next thing is the trips somebody would walk. It used to land back in the
 * library, on a needs-attention list that answered a different question with a
 * different computation.
 */

import { MoveRunView } from '../components/MoveRunView'
import { useNavigation } from '../app/navigation'

export function ArrangeScreen() {
  const { arranging, openLibraryOn, setRoute } = useNavigation()

  return (
    <MoveRunView
      range={arranging}
      onBack={() => openLibraryOn(arranging)}
      onCarry={() => setRoute('carry')}
    />
  )
}
