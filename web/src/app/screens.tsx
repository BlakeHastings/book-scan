/**
 * The route table. One line per screen, and that is the whole of it.
 *
 * Adding a screen is adding a file under `src/screens/` and a line here. Two
 * people can do that at once without meeting, which is the point of this table
 * existing at all: what used to decide which screen was drawn was a `mode`
 * value read by six conditionals inside one 1,859 line component, and every
 * new screen was an edit to the same few lines of it.
 *
 * **Each line used to carry a `chrome` flag as well, and #451 removed it.** It
 * said whether the screen wore the app's own header and tabs. The conversion
 * took that away one screen at a time — the first screen at #303, the furniture
 * at #313, the carry flow at #314, the cataloguing journey at #316, the
 * move-and-plan screen at #326, and the last of them, `review` on both its
 * paths, at #387 — because every converted screen brings the design system's own
 * top bar and four-place tab bar, and the app's header would be a second bar
 * above them saying the same thing.
 *
 * So the flag spent months reading `false` on every line, the frame it chose
 * between had one arm, and `Chrome` was never mounted. The comments below still
 * say which issue converted which group, because that is the history of the
 * table; what has gone is the column that recorded it as a live choice.
 */

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
  /*
   * The library group (#315) wears no chrome either, for the same reason: each
   * of these brings the design system's own top bar and four-place tab bar.
   *
   * **`shelves` was the exception until #387** and is not one now. It was the
   * last screen in the app drawing the header, the three pills and the blue
   * accent, and it is `ShelfView` drawn with the design system.
   */
  library: LibraryScreen,
  book: BookScreen,
  find: FindScreen,
  tags: TagsScreen,
  shelves: ShelvesScreen,
  queue: QueueScreen,
  /*
   * Changing what belongs where, and the plan it produces (#326). It wore the
   * app's frame until the whole journey was walked and this was the one screen
   * in it still dressed as the old app: describe the furniture, change a rule,
   * plan, apply, then carry books on screens that look like the new one.
   */
  arrange: ArrangeScreen,
  scan: ScanScreen,

  /*
   * The furniture, drawn with the design system and therefore without the
   * app's frame around it: each of these brings its own top bar and its own
   * four-place tab bar, and the header would be a second bar above them.
   *
   * **Three, where there were six** (#381). Adding an area stopped being a
   * screen and became a press; what belongs in a place and how it is ordered
   * stopped being two screens that explained them and became two widgets on the
   * page of the place itself.
   */
  furniture: FurnitureScreen,
  fixture: FixtureScreen,
  area: AreaScreen,

  /*
   * What the corner opens onto (#350). Not one of the furniture three: it is
   * about the collection rather than about a piece of it. It wears the same
   * frame for the same reason they do, which is that it brings its own top bar
   * and its own four-place tab bar.
   */
  settings: SettingsScreen,

  /*
   * Why one book is here (#323). Not one of the furniture three: the book page
   * reaches it too, and it goes back to whichever screen opened it.
   */
  claimed: ClaimedScreen,

  /* Putting things right, in the order the journey is walked. */
  carry: CarryScreen,
  trip: TripScreen,
  carrying: CarryingScreen,
  carried: CarriedScreen,
  carrystale: CarryStaleScreen,

  /*
   * The books no rule claims (#341), which is the other half of putting things
   * right: a carry list is books the rules want somewhere else, and this is
   * books the rules have no opinion about at all.
   */
  unclaimed: UnclaimedScreen,
}
