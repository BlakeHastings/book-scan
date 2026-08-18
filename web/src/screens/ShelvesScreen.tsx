/**
 * The shelves as a job of work, which is what the library screen used to be.
 *
 * #315 gave the library tab to the browsing half: every book somebody owns,
 * drawn three ways, with a filter and a way to find one. This is the other half
 * of what that screen carried, unchanged, and it is still reachable because the
 * things on it have nowhere else to go yet: the books that are not where they
 * now belong, and the two answers to each of them; the books that are off the
 * bookcase; the way to move a whole run to another piece of furniture.
 *
 * **It was deliberately temporary and it has outlived that.** #314 built the
 * carry flow and #313 built the furniture screens, and neither took the list of
 * books whose recorded place disagrees with where the order now puts them: that
 * is drawn here and nowhere else, and #358 repaired it after it had been
 * silently dropping 181 books. So the screen stays, and #387 dressed it with the
 * design system rather than leaving it as the last one wearing the old app.
 */

import { ShelfView } from '../components/ShelfView'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function ShelvesScreen() {
  const { setRoute, libraryReturn, setLibraryReturn, openArranging, openRoom } = useNavigation()
  const { openFromLibrary } = useOpenBook()

  return (
    <ShelfView
      onOpen={openFromLibrary}
      returnAnchor={libraryReturn}
      onReturnAnchorConsumed={() => setLibraryReturn(null)}
      /* The one door into this screen is the button at the foot of the library,
         so back is that screen. It had no back arrow at all while it wore the
         app's header, because that header had none to give. */
      onBack={() => setRoute('library')}
      /* Through `openArranging` since #323, because that screen has a second
         way in now, from the rule itself, and it has to know which one it came
         through to say where "back" goes. */
      onArrange={openArranging}
      /* The way through to the furniture, which #313 put on this screen. It
         stays where it was put: the corner's menu is the way in for somebody
         who has never found the furniture, and this is the way on for somebody
         already standing in front of the bookcases. Through `openRoom` since
         #350 so that the back arrow over there returns here rather than to the
         library. */
      onFurniture={() => openRoom('furniture')}
    />
  )
}
