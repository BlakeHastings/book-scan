Feature: A bookcase the books have not left yet says how many are standing on it

  On the owner's own catalogue, in the same second:

      GET /api/fixtures  ->  Bookshelf 4 (0 areas, 0 books)
      GET /api/carry     ->  46 books, "Bookshelf 4 · A" to "Bookshelf 2 · E"

  Both cannot be true for the person reading them, and the carrying list was the
  one that was right (#401). He had moved a stretch of books off that bookcase
  and carried none of them yet, which is a legitimate state and the only state a
  move can leave: applying one records where books belong and a person moves
  them. The shelves it takes off the bookcase are retired rather than deleted,
  because the record of where every book has been names them, and that is
  deliberate and stays (#307, #391).

  What was wrong was the reading. Everything that draws furniture asks for the
  shelves that are on a piece, which is right, and the count of books hung off
  that same reading, which is not: the two questions are one letter apart and
  they are not the same question. So a bookcase with forty-six books standing on
  it drew as nothing at all, on the room, on its own page and on the page of
  every shelf they were standing on.

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

    # This answered nothing at all for a shelf that is off the face, so the one
    # screen that could have shown somebody the books the carrying list was
    # naming was the one that refused to open.
    When I open my fixtures
    And I open the shelf called "4A"
    Then the screen should say:
      | 4A was taken out     |
      | Rendezvous with Rama |
      | Neuromancer          |
      | Dune                 |

    # It is already off the piece, so there is nothing on the piece to take off.
    And it should not offer to "Remove this area"
