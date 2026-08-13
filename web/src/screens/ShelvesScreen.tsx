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
 * **It is deliberately temporary.** #314 is building the carry flow those first
 * two belong to and #313 is building the furniture screens the third belongs to.
 * What this is not is a second library: it draws no covers and no list, and
 * nothing here duplicates the screen it came off. When both of those land, this
 * file and `ShelfView` go together.
 */

import { ShelfView } from '../components/ShelfView'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function ShelvesScreen() {
  const { libraryReturn, setLibraryReturn, setArranging, setRoute } = useNavigation()
  const { openFromLibrary } = useOpenBook()

  return (
    <ShelfView
      onOpen={openFromLibrary}
      returnAnchor={libraryReturn}
      onReturnAnchorConsumed={() => setLibraryReturn(null)}
      onArrange={(from) => { setArranging(from); setRoute('arrange') }}
      /* The way through to the furniture, which #313 put on this screen. It
         stays with the screen it was put on rather than moving to the library,
         which has its own way there once #313's own entry point settles. */
      onFurniture={() => setRoute('furniture')}
    />
  )
}
