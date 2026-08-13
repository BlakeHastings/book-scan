/**
 * The route table. One line per screen, and that is the whole of it.
 *
 * Adding a screen is adding a file under `src/screens/` and a line here. Two
 * people can do that at once without meeting, which is the point of this table
 * existing at all: what used to decide which screen was drawn was a `mode`
 * value read by six conditionals inside one 1,859 line component, and every
 * new screen was an edit to the same few lines of it.
 *
 * `chrome` says whether the screen wears the header and the tabs. The two
 * cameras do not, because they are full-screen and the page must not scroll
 * behind them, and neither do the screens drawn with the design system, which
 * bring their own top bar and four-place tab bar: the first screen since #303,
 * the furniture since #313, and the carry flow since #314.
 *
 * **`carrying` is the exception in that flow, and deliberately.** It is the
 * where-it-goes screen a newly scanned book gets, called rather than copied, so
 * it wears whatever that screen wears. See `CarryingScreen`.
 */

import type { ComponentType } from 'react'
import type { Route } from './navigation'
import { AddAreaScreen } from '../screens/AddAreaScreen'
import { AreaScreen } from '../screens/AreaScreen'
import { ArrangeScreen } from '../screens/ArrangeScreen'
import { BelongsScreen } from '../screens/BelongsScreen'
import { CaptureScreen } from '../screens/CaptureScreen'
import { CarriedScreen } from '../screens/CarriedScreen'
import { CarryScreen } from '../screens/CarryScreen'
import { CarryStaleScreen } from '../screens/CarryStaleScreen'
import { CarryingScreen } from '../screens/CarryingScreen'
import { FixtureScreen } from '../screens/FixtureScreen'
import { FurnitureScreen } from '../screens/FurnitureScreen'
import { HomeScreen } from '../screens/HomeScreen'
import { LibraryScreen } from '../screens/LibraryScreen'
import { QueueScreen } from '../screens/QueueScreen'
import { ReviewScreen } from '../screens/ReviewScreen'
import { ScanScreen } from '../screens/ScanScreen'
import { ShelveScreen } from '../screens/ShelveScreen'
import { SortingScreen } from '../screens/SortingScreen'
import { TripScreen } from '../screens/TripScreen'

export interface ScreenEntry {
  readonly view: ComponentType
  /** Whether the header, the tabs and the error line are drawn around it. */
  readonly chrome: boolean
}

export const SCREENS: Record<Route, ScreenEntry> = {
  home: { view: HomeScreen, chrome: false },
  capture: { view: CaptureScreen, chrome: false },
  review: { view: ReviewScreen, chrome: true },
  shelve: { view: ShelveScreen, chrome: true },
  library: { view: LibraryScreen, chrome: true },
  queue: { view: QueueScreen, chrome: true },
  arrange: { view: ArrangeScreen, chrome: true },
  scan: { view: ScanScreen, chrome: false },

  /*
   * The furniture, drawn with the design system and therefore without the
   * app's frame around it: each of these brings its own top bar and its own
   * four-place tab bar, and the header would be a second bar above them.
   */
  furniture: { view: FurnitureScreen, chrome: false },
  fixture: { view: FixtureScreen, chrome: false },
  area: { view: AreaScreen, chrome: false },
  addarea: { view: AddAreaScreen, chrome: false },
  belongs: { view: BelongsScreen, chrome: false },
  sorting: { view: SortingScreen, chrome: false },

  /* Putting things right, in the order the journey is walked. */
  carry: { view: CarryScreen, chrome: false },
  trip: { view: TripScreen, chrome: false },
  carrying: { view: CarryingScreen, chrome: true },
  carried: { view: CarriedScreen, chrome: false },
  carrystale: { view: CarryStaleScreen, chrome: false },
}
