Feature: Removing a boundary between two areas

  Every boundary is drawn as a line with a Remove on it, and the line belongs
  to the area it opens: it sits above that area's heading, and Remove on it
  deletes that area's boundary.

  Both halves of that are asserted here, and separately, because #145 got both
  wrong in the same direction and so looked self-consistent from either side.
  The line said "New bookcase starts here" while sitting under the bookcase it
  started, and Remove on it deleted the boundary one place away from the one it
  named. Three books were reported as moving 2A to 1B and a fourth 2B to 1C,
  and the app told somebody to go and carry four books to planks they do not
  belong on. There is no undo, and nothing puts a boundary back.

  So the removal is proved at the database: which separator row went, and which
  books changed plank. A scenario reading only the labels would have passed
  every day this defect was shipped.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | Dune                 | Frank Herbert     |
      | The Dispossessed     | Ursula K. Le Guin |
    And "1A" filled up twice, so its last two books are on bookcase 2
    And "2A" filled up, so its last book started a new area

  # The visible half, on its own so that it fails on its own. Each line names
  # the heading directly beneath it, which is the area its boundary opens.
  Scenario: Every line names the heading beneath it
    When I open the app
    And I go to the library
    Then the library should read, top to bottom:
      | Bookcase 1 Area A        |
      | New bookcase starts here |
      | Bookcase 2 Area A        |
      | New area starts here     |
      | Bookcase 2 Area B        |

  # The dangerous half, asserted without reading a single label until the end.
  # The line between 2A and 2B is 2B's own plank break, not the bookcase break
  # above 2A, and this is the tap that used to delete the wrong one.
  Scenario: The line above an area removes that area's boundary
    When I open the app
    And I go to the library
    And I remove the boundary drawn above "Bookcase 2 Area B"

    Then the boundaries recorded for fiction should be:
      | kind  | starts at |
      | shelf | Dune      |

    # Which books changed plank, and no others. Bookcase 2 keeps its number
    # because the bookcase break survived; only the plank break went.
    And the library should show "Dune" on shelf "2A"
    And the library should show "The Dispossessed" on shelf "2A"
    And the library should show "Neuromancer" on shelf "1A"
    And it should say to move exactly:
      | book             | from | to |
      | The Dispossessed | 2B   | 2A |

    # Nothing wrote a location. A boundary change moves the furniture; where a
    # book physically is only changes when a person says they moved it, which
    # is why the app is asking for that one book to be carried.
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 2B |
    And the catalogue should hold "Dune" recorded as:
      | location | 2A |
    And the catalogue should hold "Neuromancer" recorded as:
      | location | 1A |

    # And the line that is left reads against the heading it still opens.
    When I go to the library
    Then the library should read, top to bottom:
      | Bookcase 1 Area A        |
      | New bookcase starts here |
      | Bookcase 2 Area A        |
