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
      // The one door into this screen is the button at the foot of the library, so back is that screen.
      onBack={() => setRoute('library')}
      // Through `openArranging`, because that screen has a second way in, from the rule itself, and needs to know which one it came through to say where "back" goes.
      onArrange={openArranging}
      // Through `openRoom`, not a plain route change, so the back arrow over there returns here rather than to the library.
      onFurniture={() => openRoom('furniture')}
    />
  )
}
