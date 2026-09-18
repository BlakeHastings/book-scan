Feature: A move says what it does to the furniture, and deletes none of it

  The last run in a room has no run after it to stop at, so a piece standing
  past its end is the tail of that run whether or not its owner thinks of it
  that way, and moving the run takes its shelves along. That is a real
  consequence of a real request. What is not is deleting anything: a shelf or a
  bookcase a move leaves empty is retired, not deleted. A piece of furniture is
  a thing standing in a room, and it goes only when somebody says so, through
  the screen that takes furniture away and refuses while books or rules are on
  it.

  So the move retires what it takes and deletes nothing at all, and the plan
  says what else moves and what it would leave bare, before anybody presses
  anything.

  Background:
    Given the catalogue is empty
    And the catalogue already holds these non-fiction books:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | Dune                 | Frank Herbert     |
    And a bookcase called "Hall" stands after them, with these shelves:
      |        |
      |        |
      |        |
      | Comics |

  Scenario: The plan names the shelves that move and the piece it would empty
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3

    Then the plan should say:
      | 4A to 3A |

    And the plan should say:
      | move with them             |
      | Hall · Comics becomes      |
      | leaves Hall with nothing   |
      | Nothing is thrown away     |

  Scenario: Applying it leaves the bookcase standing and deletes no row
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3
    And I apply the plan

    Then the catalogue should still hold a piece called "Hall"
    And the catalogue should still hold an area called "Comics"

    When I open my fixtures
    Then my fixtures should still include "Hall"

  Scenario: A shelf with no rule of its own offers to say what belongs there
    When I open the app
    And I open my fixtures
    And I open the shelf called "Hall · Comics"
    Then it should offer to "Say what belongs here"
    And it should not offer to "Change what belongs here"
