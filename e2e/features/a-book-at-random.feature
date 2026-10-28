Feature: A book off the shelves at random

  The owner asked for it on 2026-10-29 (#657):

    a random book generator, aka where we can select to just get a random
    pull from the bookshelf. It should just open up a random book detail view
    for the user whenever they click that button and we should put it on the
    homepage.

  The server picks, so which book opens is not known in advance. What is known
  is that it is one on the shelves: never a book that is out, and never an
  empty page when there is nothing to pick.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author           |
      | Rendezvous with Rama | Arthur C. Clarke |
      | The Dispossessed     | Ursula K. Le Guin |
      | Neuromancer          | William Gibson   |

  Scenario: The first screen opens a book that is on the shelves
    Given "Neuromancer" is off the bookcase
    When I open the app
    And I pick a book at random
    Then it should open one of:
      | Rendezvous with Rama |
      | The Dispossessed     |

  Scenario: With every book out there is nothing to pick, so nothing is offered
    Given "Rendezvous with Rama" is off the bookcase
    And "The Dispossessed" is off the bookcase
    And "Neuromancer" is off the bookcase
    When I open the app
    Then the first screen should not offer a book at random
