/** The route table. One line per screen, added alongside a file under `src/screens/`. */

import type { ComponentType } from 'react'
import type { Route } from './navigation'
import { AreaScreen } from '../screens/AreaScreen'
import { ArrangeScreen } from '../screens/ArrangeScreen'
import { BookScreen } from '../screens/BookScreen'
import { CaptureScreen } from '../screens/CaptureScreen'
import { ClaimedScreen } from '../screens/ClaimedScreen'
import { CarriedScreen } from '../screens/CarriedScreen'
import { CarryScreen } from '../screens/CarryScreen'
import { CarryStaleScreen } from '../screens/CarryStaleScreen'
import { CarryingScreen } from '../screens/CarryingScreen'
import { FindScreen } from '../screens/FindScreen'
import { FixtureScreen } from '../screens/FixtureScreen'
import { FurnitureScreen } from '../screens/FurnitureScreen'
import { HomeScreen } from '../screens/HomeScreen'
import { LibraryScreen } from '../screens/LibraryScreen'
import { QueueScreen } from '../screens/QueueScreen'
import { ReviewScreen } from '../screens/ReviewScreen'
import { ScanScreen } from '../screens/ScanScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { ShelveScreen } from '../screens/ShelveScreen'
import { ShelvesScreen } from '../screens/ShelvesScreen'
import { TagsScreen } from '../screens/TagsScreen'
import { TripScreen } from '../screens/TripScreen'
import { UnclaimedScreen } from '../screens/UnclaimedScreen'

export const SCREENS: Record<Route, ComponentType> = {
  home: HomeScreen,
  capture: CaptureScreen,
  review: ReviewScreen,
  shelve: ShelveScreen,
  library: LibraryScreen,
  book: BookScreen,
  find: FindScreen,
  tags: TagsScreen,
  shelves: ShelvesScreen,
  queue: QueueScreen,
  arrange: ArrangeScreen,
  scan: ScanScreen,
  furniture: FurnitureScreen,
  fixture: FixtureScreen,
  area: AreaScreen,
  settings: SettingsScreen,
  claimed: ClaimedScreen,
  carry: CarryScreen,
  trip: TripScreen,
  carrying: CarryingScreen,
  carried: CarriedScreen,
  carrystale: CarryStaleScreen,
  unclaimed: UnclaimedScreen,
}
