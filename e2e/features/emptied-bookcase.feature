Feature: A bookcase the books have not left yet says how many are standing on it

  A bookcase that a move has taken books off is a legitimate state, and the only
  one a move can leave: applying a move records where books belong, and a person
  moves them physically. The shelves it takes off the bookcase are retired
  rather than deleted, because the record of where every book has been names
  them, and that is deliberate.

  The difference from `moving-a-run.feature` is the room. There, a bookcase
  somebody put up stands after the run, so the run flows onto it and comes back
  round to the bookcase it left. Here nothing stands after it, so every shelf of
  the run lands on the destination and the bookcase it came off is left bare
  with all of its books still on it. That is the owner's room.

  Background:
    Given the catalogue is empty
    And the catalogue already holds these non-fiction books:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | Dune                 | Frank Herbert     |

  Scenario: The room says the bookcase still holds its books, and names the shelf
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3
    And I apply the plan

    When I open my fixtures
    Then the screen should say:
      | Bookcase 4 |
      | 3 books    |
      | 4A         |
      | Taken out  |

  Scenario: The books still have a page, and it does not offer to remove a shelf twice
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3
    And I apply the plan

    When I open my fixtures
    And I open the shelf called "4A"
    Then the screen should say:
      | 4A was taken out |

    And the row of books should name:
      | Rendezvous with Rama |
      | Neuromancer          |
      | Dune                 |

    And it should not offer to "Remove this area"
