/**
 * The providers are nested in dependency order, each reading only from the ones outside it:
 *
 *     error -> navigation -> arranging -> browsing -> book in hand -> summary
 *           -> camera -> armful
 *
 * State shared across screens lives in a provider rather than in screen state because a
 * screen unmounts when the route changes, which would drop anything it held.
 *
 * There is no state library and no URL routing. See `app/navigation.tsx` for why not for the URL.
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

/** The screen component changes type when the route does, so React unmounts the old one and its state along with it. */
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
          {/* Inside navigation because it reads the route table's names, outside the book in hand because looking at a book is not picking one up. */}
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
