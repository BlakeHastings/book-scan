/**
 * The app, which is now a route table and the state four screens share.
 *
 * This file was 1,859 lines: one component, about fifty `useState` hooks and a
 * `mode` value deciding what was drawn. Every screen was an edit to the same
 * few lines of it, which is what made building the rest of the interface a
 * queue rather than a set of parallel jobs (#309).
 *
 * What it is now:
 *
 * - `app/screens.tsx` is the route table, one line per screen.
 * - `screens/*.tsx` is one file per screen. A screen owns the state that only
 *   it uses, and there is more of that than the old file suggested.
 * - `app/*.tsx` is what is genuinely shared, split by what it is about rather
 *   than gathered into one store: the book in hand, the collection's summary,
 *   the camera session, where the screen is, and the error line.
 *
 * The providers are nested in dependency order, each reading only from the
 * ones outside it:
 *
 *     error -> navigation -> arranging -> browsing -> book in hand -> summary
 *           -> camera -> armful
 *
 * The last one is the books somebody is carrying across a room (#314). It is
 * innermost because it reads nothing and is read by four screens, and it is a
 * provider rather than screen state for exactly that reason: a screen unmounts
 * when the route changes, and an armful held by one of them would be dropped on
 * the way to the next.
 *
 * `browsing` is the same argument about the library (#315): what is being
 * looked at is shared by three screens and held by none of them, because
 * opening a book unmounts all three.
 *
 * There is no state library and no URL routing. Both are decisions rather than
 * omissions, and the reasons are written down: `app/navigation.tsx` for the
 * URL, and the split above for the store.
 */

import { ArmfulProvider } from './app/armful'
import { ArrangingProvider } from './app/arranging'
import { BookInHandProvider } from './app/bookInHand'
import { BrowsingProvider } from './app/browsing'
import { CameraSessionProvider } from './app/cameraSession'
import { SummaryProvider } from './app/summary'
import { ErrorBannerProvider } from './app/errorBanner'
import { NavigationProvider, useNavigation } from './app/navigation'
import { SCREENS } from './app/screens'

/**
 * Draw whichever screen the route names.
 *
 * The screen component changes type when the route does, so React unmounts the
 * old one. That is what carries "state that belongs to one screen goes away
 * with it", and it is why a screen can hold its own state without having to
 * clear it on the way out.
 *
 * There used to be a frame to choose between here, drawn for a screen whose
 * table entry asked for one. Every screen stopped asking as it was converted,
 * and #451 removed the frame and the choice: a screen wears the design system's
 * own top bar, and the red line is drawn by the three screens that write to it.
 */
function CurrentScreen() {
  const { route } = useNavigation()
  const View = SCREENS[route]
  return <View />
}

export default function App() {
  return (
    <ErrorBannerProvider>
      <NavigationProvider>
        <ArrangingProvider>
          {/*
            What somebody is looking at in the library, which three screens
            share and none of them can hold: choosing a tag happens on one, the
            books it narrows are drawn on another, and opening a book unmounts
            both. Inside navigation because it reads the route table's names,
            outside the book in hand because looking at a book is not picking
            one up.
          */}
          <BrowsingProvider>
            <BookInHandProvider>
              <SummaryProvider>
                <CameraSessionProvider>
                  <ArmfulProvider>
                    <CurrentScreen />
                  </ArmfulProvider>
                </CameraSessionProvider>
              </SummaryProvider>
            </BookInHandProvider>
          </BrowsingProvider>
        </ArrangingProvider>
      </NavigationProvider>
    </ErrorBannerProvider>
  )
}
