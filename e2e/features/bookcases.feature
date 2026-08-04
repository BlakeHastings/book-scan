Feature: Moving a book across a bookcase boundary

  Within a range the areas are one continuous sequence, and a bookcase boundary
  is only where that sequence breaks across furniture. So the first book of 2A
  moves back to the last area of bookcase 1 exactly as the first book of 1B
  moves back to 1A.

  What differs is which boundary gets re-anchored, and that is the part worth
  checking against the database rather than the screen: crossing a bookcase
  break has to move the bookcase break, or the books past it come along for the
  ride and end up on furniture nobody carried them to.

  The move is started from the book's own page, not the library (#96), the
  same as any other boundary adjustment.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | Dune                 | Frank Herbert     |
      | The Dispossessed     | Ursula K. Le Guin |
    And "1A" filled up twice, so its last two books are on bookcase 2

  Scenario: The first book of bookcase 2 goes back to the last area of bookcase 1
    When I open the app
    And I go to the library
    Then the library should show "Dune" on shelf "2A"
    And the library should show "Neuromancer" on shelf "1A"
    And the library should offer no boundary moves

    # A bookcase break is crossable like any other boundary. The two outer
    # edges of the range are not, and are still not offered.
    When I open "Neuromancer" from the library
    Then the book should offer to move it:
      | Move it on to 2A |

    When I open "Dune" from the library
    Then the book should offer to move it:
      | Move it back to 1A |

    When I choose to move it back to "1A"
    Then it should tell me to put "Dune" in the gap at "1A"

    When I say it fits and finish the move
    Then the library should show "Dune" on shelf "1A"
    And the catalogue should hold "Dune" recorded as:
      | location | 1A |

    # The bookcase break moved, so the book on the far side of it stayed on
    # the bookcase it was already on.
    And the library should show "The Dispossessed" on shelf "2A"
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 2A |
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |

    And nothing should need attention
