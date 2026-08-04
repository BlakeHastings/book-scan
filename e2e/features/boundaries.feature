Feature: Adjusting where one area ends

  A plank stops where somebody ran out of room, not where the books say it
  should, so where an area ends is the one arbitrary thing in this model and it
  has to be adjustable by hand.

  Only the first and last book of an area can be moved, and only to the plank
  beside it. That is not a limited version of drag and drop: it is the complete
  set of moves that leave every other book where it was, because the last book
  of an area becomes the first of the next one without gaining or losing a
  single neighbour.

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

    # Offered on exactly two books out of three, and in one direction each.
    # There is nothing before 1A and nothing after 1B, and a book in the middle
    # of a plank cannot move at all without being filed out of order.
    And the library should offer only these boundary moves:
      | Dune is last here              | Moved it on to 1B   |
      | The Dispossessed is first here | Moved it back to 1A |

    When I say I moved "Dune" on to "1B"
    Then the library should show "Dune" on shelf "1B"
    And the catalogue should hold "Dune" recorded as:
      | location | 1B |

    # The point of the restriction: nobody else was asked to move.
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |

    # It moved for a real reason and the record matches the room, so there is
    # nothing to report.
    And nothing should need attention

    When I say I moved "Dune" back to "1A"
    Then the library should show "Dune" on shelf "1A"
    And the catalogue should hold "Dune" recorded as:
      | location | 1A |
    And nothing should need attention
