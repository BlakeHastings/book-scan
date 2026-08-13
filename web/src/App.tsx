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
 *     error -> navigation -> arranging -> book in hand -> summary -> camera -> armful
 *
 * The last one is the books somebody is carrying across a room (#314). It is
 * innermost because it reads nothing and is read by four screens, and it is a
 * provider rather than screen state for exactly that reason: a screen unmounts
 * when the route changes, and an armful held by one of them would be dropped on
 * the way to the next.
 *
 * There is no state library and no URL routing. Both are decisions rather than
 * omissions, and the reasons are written down: `app/navigation.tsx` for the
 * URL, and the split above for the store.
 */

import { ArmfulProvider } from './app/armful'
import { ArrangingProvider } from './app/arranging'
import { BookInHandProvider } from './app/bookInHand'
import { CameraSessionProvider } from './app/cameraSession'
import { Chrome } from './app/Chrome'
import { SummaryProvider } from './app/summary'
import { ErrorBannerProvider } from './app/errorBanner'
import { NavigationProvider, useNavigation } from './app/navigation'
import { SCREENS } from './app/screens'

/**
 * Draw whichever screen the route names, inside the frame if it wears one.
 *
 * The screen component changes type when the route does, so React unmounts the
 * old one. That is what carries "state that belongs to one screen goes away
 * with it", and it is why a screen can hold its own state without having to
 * clear it on the way out.
 */
function CurrentScreen() {
  const { route } = useNavigation()
  const { view: View, chrome } = SCREENS[route]

  if (!chrome) return <View />
  return (
    <Chrome>
      <View />
    </Chrome>
  )
}

export default function App() {
  return (
    <ErrorBannerProvider>
      <NavigationProvider>
        <ArrangingProvider>
          <BookInHandProvider>
            <SummaryProvider>
              <CameraSessionProvider>
                <ArmfulProvider>
                  <CurrentScreen />
                </ArmfulProvider>
              </CameraSessionProvider>
            </SummaryProvider>
          </BookInHandProvider>
        </ArrangingProvider>
      </NavigationProvider>
    </ErrorBannerProvider>
  )
}
