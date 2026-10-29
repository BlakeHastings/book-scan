Feature: Throwing a book away

  Somebody scanning a collection photographs a book twice, or photographs the
  wrong thing, and wants it gone. They try where they are standing: the screen
  that has just told them the book is a second copy, the queue they slid it out
  of, or the book's own page in the library. Each of those either takes the book
  away or says why it did not.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title | author        |
      | Dune  | Frank Herbert |
    And the camera is pointed at the back cover of "Dune"

  Scenario: A second copy is thrown away from the screen that says it is one
    When I open the app
    And I start the camera
    And I photograph the book
    Then it should say the book is already catalogued

    When I go to the queue
    And I open the queued book
    Then it should say saving adds a second copy

    When I discard the scan
    Then the queue should hold 0 books
    And the catalogue should hold one copy of "Dune"

  Scenario: A book slid out of the queue goes even when somebody moves straight on
    When I open the app
    And I start the camera
    And I photograph the book
    Then it should say the book is already catalogued

    When I go to the queue
    And I slide the queued book away
    Then the queued book should say it is being discarded

    When I leave by the "Library" tab
    Then the queue should come to hold 0 books
    And the catalogue should hold one copy of "Dune"

  Scenario: A book is deleted from its own page
    When I open the app
    And I pick a book at random
    Then it should open one of:
      | Dune |

    When I delete the book from its own page
    Then the catalogue should hold no book called "Dune"
