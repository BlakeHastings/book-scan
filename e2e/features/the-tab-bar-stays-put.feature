Feature: The four places stay against the bottom of the glass

  `.wf-tabs` is `position: sticky; bottom: 0`, and a sticky box stays pinned
  only while its containing block, `.wf-screen`, is still under it as the page
  scrolls. Draw anything else after the screen inside the same scroller and the
  containing block ends before the scroll does, so the bar comes loose partway
  up the phone.

  Nothing that renders a component to markup can see any of this: the same
  `<nav>` of four buttons comes out whether the bar is at the bottom of the
  glass or halfway up the phone, because markup has no layout and no scroll
  position. This is the same answer as the corner sheet's: drive a real page,
  scroll it, and read boxes.

  Background:
    Given the catalogue is empty

  Scenario: A screen taller than the phone, scrolled to the bottom
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
    When I open the wireframe of the library
    And I scroll to the bottom of the screen
    Then the four places should be against the bottom of the glass
    And the way on to the next screen should be above them

  Scenario: The screen the cat lies across, while he is moving
    Given the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |
    When I open the app
    Then the four places should stay against the bottom of the glass for 13 seconds
