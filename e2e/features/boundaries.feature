Feature: Adjusting where one area ends

  A plank stops where somebody ran out of room, not where the books say it
  should, so where an area ends is the one arbitrary thing in this model and it
  has to be adjustable by hand.

  Only the first and last book of an area can be moved, and only to the plank
  beside it. That is not a limited version of drag and drop: it is the complete
  set of moves that leave every other book where it was, because the last book
  of an area becomes the first of the next one without gaining or losing a
  single neighbour.

  The move lives on the book's own page, offered only when that book is
  genuinely at an edge. The library draws the shelves; it does not offer
  a control that can move the wrong book with one misplaced tap in a scrolling
  run of spines.

  The assertions go to the database and to the "needs attention" list, because
  the way to get this wrong is to move the boundary and not record where the
  book went, which turns a move somebody just made into a move the app tells
  them to make.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |
      | The Dispossessed     | Ursula K. Le Guin |
    And "1A" filled up, so its last book started a new area

  Scenario: A book is bounced across the boundary, and bounced back
    When I open the app
    And I go to the library
    Then the library should show "Dune" on shelf "1A"
    And the library should offer no boundary moves

    When I open "Rendezvous with Rama" from the library
    Then the book should not offer to move it

    When I go to the library
    And I open "Dune" from the library
    Then the book should offer to move it:
      | Move it on to 1B |

    When I choose to move it on to "1B"
    Then it should tell me to put "Dune" in the gap at "1B"

    When I say it fits and finish the move
    Then the library should show "Dune" on shelf "1B"
    And the catalogue should hold "Dune" recorded as:
      | location | 1B |

    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |

    And nothing should need attention

    When I open "Dune" from the library
    Then the book should offer to move it:
      | Move it back to 1A |

    When I choose to move it back to "1A"
    And I say it fits and finish the move
    Then the library should show "Dune" on shelf "1A"
    And the catalogue should hold "Dune" recorded as:
      | location | 1A |

    And the library should show "The Dispossessed" on shelf "1B"
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |
    And nothing should need attention

  Scenario: A move nobody acted on is taken back, without claiming a walk
    When I open the app
    And I go to the library
    And I open "The Dispossessed" from the library
    Then the book should offer to move it:
      | Move it back to 1A |

    When I choose to move it back to "1A", which empties the area
    And I agree that the area goes
    And I go back to the book details

    Then the book should not offer to move it

    When I go to the library
    Then the list should offer to undo the move for "The Dispossessed"

    When I undo the move for "The Dispossessed"
    Then nothing should need attention

    And the library should show "The Dispossessed" on shelf "1B"
    And the library should show "Dune" on shelf "1A"

    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |

  Scenario: The move that takes an area with it says so, and waits to be told
    When I open the app
    And I go to the library
    And I open "The Dispossessed" from the library
    Then the book should offer to move it:
      | Move it back to 1A |

    When I choose to move it back to "1A", which empties the area
    Then it should say that "1B" goes with the book

    When I keep the area
    And I go to the library
    Then the library should show "The Dispossessed" on shelf "1B"
    And the library should show "Dune" on shelf "1A"
    And nothing should need attention
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |

  Scenario: The notice on a book is the door to the step that places it
    When I open the app
    And I go to the library
    And I open "Dune" from the library
    Then the book should offer to move it:
      | Move it on to 1B |

    When I choose to move it on to "1B"
    And I go back to the book details
    Then the book should say it is supposed to be moved
    And the book should not offer to move it

    When I press the notice about moving it
    Then the shelf drawing should be labelled "1B"

    When I say it fits and finish the move
    Then nothing should need attention
    And the library should show "Dune" on shelf "1B"
    And the catalogue should hold "Dune" recorded as:
      | location | 1B |
