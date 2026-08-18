Feature: The four places stay against the bottom of the glass

  The owner reported the app's only permanent navigation coming loose:

    Whenever I scroll down, the bar at the bottom with Today, Library, Scan and
    Queue ends up scrolling up a bit for some reason, so it ends up in the
    middle of the screen, which is not ideal.

  `.wf-tabs` was `position: sticky; bottom: 0`, and a sticky box is pinned only
  while its containing block is under it. That block is `.wf-screen`, so the
  four places were on the glass exactly as long as nothing was drawn after the
  screen inside the same scroller. The wireframe draws its way on to the next
  screen there, and the bar came to rest 47px up the phone on every screen in
  it, from the first scroll onwards.

  Nothing that renders a component to markup can see any of this: the same
  `<nav>` of four buttons comes out whether the bar is at the bottom of the
  glass or halfway up the phone, because markup has no layout and no scroll
  position. That is what #393 found about the corner sheet, and these scenarios
  are the other answer it gave: drive a real page, scroll it, and read boxes.

  Background:
    Given the catalogue is empty

  Scenario: A screen taller than the phone, scrolled to the bottom
    # Books are what he was looking at, and this is the screen they stand on.
    # What makes it long is planks rather than books: a bookcase draws one row
    # per area whatever is on it, so the padding fills a plank and the fills
    # spread it over three. The step that scrolls says so if this stops being
    # enough.
    Given 12 more books are on the shelves, all filing before "Dune"
    And 12 more books are on the shelves, all filing after "Dune"
    And the areas filled up in this order:
      | 1A |
      | 1A |
      | 1A |
      | 1B |
      | 1B |
    When I open the app
    And I go to the library
    And I scroll to the bottom of the screen
    Then the four places should be against the bottom of the glass
    And nothing on the screen should be hidden behind them

  Scenario: A screen with something else drawn after it
    # The reproduction. A bar that reserves its own room at the bottom of the
    # flow is right by accident of what its siblings happen to be, and this is
    # the one place in either the app or the wireframe where that accident does
    # not hold. The second question is the price of the fix: a fixed bar covers
    # the bottom of the glass at every scroll position, including the last one,
    # so the way on has to be able to get out from under it.
    When I open the wireframe of the library
    And I scroll to the bottom of the screen
    Then the four places should be against the bottom of the glass
    And the way on to the next screen should be above them

  Scenario: The screen the cat lies across, while he is moving
    # A transform on an ancestor makes a fixed descendant position against that
    # ancestor rather than against the viewport, and #412 put two animated
    # transforms on the first screen. He is not an ancestor of the tab bar, so
    # this holds; it is here because the reasoning that says so is exactly the
    # reasoning that would stop being true without anybody noticing.
    Given the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |
    When I open the app
    Then the four places should stay against the bottom of the glass for 13 seconds
