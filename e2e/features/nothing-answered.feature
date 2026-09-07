Feature: The first screen says so when nothing answered

  The first screen is made of two reads, the collection's counts and the
  queue's, and until #562 both ended in a bare catch that did nothing:

    api.health().then(...).catch(() => {})
    api.listCaptures().then(...).catch(() => {})

  Neither value is drawn until it has answered, which is right: drawing zeros
  would say something false about somebody's collection for as long as the first
  request takes. But both begin empty and both stayed empty after a failure, so
  the screen a person got when nothing came back was the screen they get for the
  first half second of every ordinary visit. A top bar, a tab bar, and white
  space, until they happened to navigate somewhere else and back, because the
  reads are keyed on the route.

  Nothing distinguished that from a collection with nothing in it, from an app
  still starting, or from a server that was not there.

  Four other reads on this screen already set their value to null when they fail
  and say why in a comment above each one. Copying them here would have changed
  nothing a person sees, because both values are already null on a first load,
  which is why this is driven in a browser rather than asserted from props: a
  rendered component cannot tell whether the catch that set the value ran.

  The gate's two refusals are deliberately not this. A 401 or a 403 reaches
  lib/api.ts, which tells whenTheGateRefuses before it throws, and app/gate.tsx
  replaces this screen with the way in or the waiting screen. So the session is
  left reachable in this scenario and the last step is that nobody was asked to
  sign in.

  Background:
    Given the catalogue is empty

  Scenario: The two reads the first screen is made of do not come back
    Given nothing answers the first screen
    When I open the app with nothing answering
    Then it should say it could not count my books
    And there should be no counts on the screen
    And the app should have offered me no way in
