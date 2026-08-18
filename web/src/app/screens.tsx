/**
 * The route table. One line per screen, and that is the whole of it.
 *
 * Adding a screen is adding a file under `src/screens/` and a line here. Two
 * people can do that at once without meeting, which is the point of this table
 * existing at all: what used to decide which screen was drawn was a `mode`
 * value read by six conditionals inside one 1,859 line component, and every
 * new screen was an edit to the same few lines of it.
 *
 * `chrome` says whether the screen wears the header and the tabs. Most no
 * longer do: the two cameras are full-screen and the page behind them must not
 * scroll, and every screen converted to the design system brings its own top
 * bar and four-place tab bar, so the app's header would be a second bar above
 * them saying the same thing. That is the first screen since #303, the
 * furniture since #313, the carry flow since #314, the cataloguing journey
 * since #316 and the move-and-plan screen since #326.
 *
 * **`carrying` still wears whatever the where-it-goes screen wears**, which is
 * the point of it calling that screen rather than copying it. That screen is
 * converted now, so this one is too, and the two are still one component with
 * one frame around it rather than two that agree today.
 *
 * **`review` is converted on both its paths since #387**, which is what took
 * the last condition out of this table's neighbourhood: it drew a queued
 * capture with the design system and a catalogued book with what the app
 * always had, and asked for the frame itself on the second one. Both wear
 * their own top bar and their own tab bar now, so the line below says what
 * every other line says and nothing asks for a header underneath it.
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

export interface ScreenEntry {
  readonly view: ComponentType
  /** Whether the header, the tabs and the error line are drawn around it. */
  readonly chrome: boolean
}

export const SCREENS: Record<Route, ScreenEntry> = {
  home: { view: HomeScreen, chrome: false },
  capture: { view: CaptureScreen, chrome: false },
  review: { view: ReviewScreen, chrome: false },
  shelve: { view: ShelveScreen, chrome: false },
  /*
   * The library group (#315) wears no chrome either, for the same reason: each
   * of these brings the design system's own top bar and four-place tab bar.
   *
   * `shelves` is the exception and keeps the app's frame, because it is what
   * the library screen used to be and is unconverted: it draws `ShelfView`
   * exactly as it was.
   */
  library: { view: LibraryScreen, chrome: false },
  book: { view: BookScreen, chrome: false },
  find: { view: FindScreen, chrome: false },
  tags: { view: TagsScreen, chrome: false },
  shelves: { view: ShelvesScreen, chrome: true },
  queue: { view: QueueScreen, chrome: false },
  /*
   * Changing what belongs where, and the plan it produces (#326). It wore the
   * app's frame until the whole journey was walked and this was the one screen
   * in it still dressed as the old app: describe the furniture, change a rule,
   * plan, apply, then carry books on screens that look like the new one.
   */
  arrange: { view: ArrangeScreen, chrome: false },
  scan: { view: ScanScreen, chrome: false },

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
  furniture: { view: FurnitureScreen, chrome: false },
  fixture: { view: FixtureScreen, chrome: false },
  area: { view: AreaScreen, chrome: false },

  /*
   * What the corner opens onto (#350). Not one of the furniture three: it is
   * about the collection rather than about a piece of it. It wears the same
   * frame for the same reason they do, which is that it brings its own top bar
   * and its own four-place tab bar.
   */
  settings: { view: SettingsScreen, chrome: false },

  /*
   * Why one book is here (#323). Not one of the furniture three: the book page
   * reaches it too, and it goes back to whichever screen opened it.
   */
  claimed: { view: ClaimedScreen, chrome: false },

  /* Putting things right, in the order the journey is walked. */
  carry: { view: CarryScreen, chrome: false },
  trip: { view: TripScreen, chrome: false },
  carrying: { view: CarryingScreen, chrome: false },
  carried: { view: CarriedScreen, chrome: false },
  carrystale: { view: CarryStaleScreen, chrome: false },

  /*
   * The books no rule claims (#341), which is the other half of putting things
   * right: a carry list is books the rules want somewhere else, and this is
   * books the rules have no opinion about at all.
   */
  unclaimed: { view: UnclaimedScreen, chrome: false },
}
