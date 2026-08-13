/** The shelves, as they stand. */

import { ShelfView } from '../components/ShelfView'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'

export function LibraryScreen() {
  const { libraryReturn, setLibraryReturn, setArranging, setRoute } = useNavigation()
  const { openFromLibrary } = useOpenBook()

  return (
    <ShelfView
      onOpen={openFromLibrary}
      returnAnchor={libraryReturn}
      onReturnAnchorConsumed={() => setLibraryReturn(null)}
      onArrange={(from) => { setArranging(from); setRoute('arrange') }}
    />
  )
}
