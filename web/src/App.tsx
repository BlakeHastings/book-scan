/**
 * The providers are nested in dependency order, each reading only from the ones outside it:
 *
 *     error -> navigation -> arranging -> browsing -> book in hand -> summary
 *           -> camera -> armful -> back gesture
 *
 * State shared across screens lives in a provider rather than in screen state because a
 * screen unmounts when the route changes, which would drop anything it held.
 *
 * There is no state library and no URL routing. See `app/navigation.tsx` for why not for the URL,
 * and `lib/backGuard.ts` for how the phone's back gesture is kept anyway.
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
import { SystemBackProvider } from './app/systemBack'
import { useLeaving } from './app/leaving'
import { useCameraSession } from './app/cameraSession'
import type { ReactNode } from 'react'

/** The screen component changes type when the route does, so React unmounts the old one and its state along with it. */
function CurrentScreen() {
  const { route } = useNavigation()
  const View = SCREENS[route]
  return <View />
}

/**
 * Back on a screen that drew no back arrow of its own, which is a tab: to the first screen, the way
 * its own tab leads there. On the first screen there is nowhere further in, so back leaves the app.
 * The camera turns itself off on the way, as its own way out does.
 */
function BackGesture({ children }: { children: ReactNode }) {
  const { route, setRoute } = useNavigation()
  const { leaveFor } = useLeaving()
  const { stopCamera } = useCameraSession()
  const fallback = route === 'home'
    ? null
    : route === 'capture'
      ? () => { stopCamera(); setRoute('home') }
      : () => leaveFor('home')
  return <SystemBackProvider fallback={fallback}>{children}</SystemBackProvider>
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
                    <BackGesture>
                      <CurrentScreen />
                    </BackGesture>
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
