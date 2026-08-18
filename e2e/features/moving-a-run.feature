Feature: A move says what it does to the furniture, and deletes none of it

  Somebody put up a bookcase in the hall, hung four shelves on it and named one
  of them Comics. Then they moved their non-fiction books from bookcase 4 onto
  bookcase 3. Afterwards the hall bookcase was gone: its four areas deleted, the
  name with them, and not one word about it on any screen. The plan they had read
  named seven books and three trips, and every confirmation afterwards was about
  books (#391, found by the usability baseline in #388).

  Two things were wrong and only one of them is a warning.

  The last run in a room has no run after it to stop at, so a piece standing
  past its end is the tail of that run whether or not its owner thinks of it
  that way, and moving the run takes its shelves along. That is a real
  consequence of a real request. What is not is deleting anything: a shelf
  nobody had filled yet was deleted rather than retired, and a bookcase left
  with nothing on it was deleted after it. A piece of furniture is a thing
  standing in a room. It goes when somebody says so, through the screen that
  takes furniture away and refuses while books or rules are on it.

  So the move now retires what it takes and deletes nothing at all, and the plan
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

    # The books, which is all this screen used to say.
    Then the plan should say:
      | 4A to 3A |

    # And the furniture, which is what nobody was told. The hall bookcase is the
    # tail of this run, so its four shelves come along and it is left bare.
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

    # In the database first, because a piece that draws correctly and was
    # deleted underneath is the failure a screen-only check waves through.
    Then the catalogue should still hold a piece called "Hall"
    And the catalogue should still hold an area called "Comics"

    When I open my fixtures
    Then my fixtures should still include "Hall"

  Scenario: A shelf with no rule of its own offers to say what belongs there
    # The other half of #391. This shelf files by overflow from the run before
    # it, so the card names that rule and the button used to offer to change it.
    # It opened an editor holding nothing, and the whole journey through a
    # preview and "Write it down" ended in "Nothing changed about where the
    # books belong", which was true and read as work being lost.
    When I open the app
    And I open my fixtures
    And I open the shelf called "Hall · Comics"
    Then it should offer to "Say what belongs here"
    And it should not offer to "Change what belongs here"
