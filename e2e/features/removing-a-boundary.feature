Feature: Removing a boundary between two areas

  Every boundary is drawn as a line with a Remove on it, and the line belongs
  to the area it opens: it sits above that area's heading, and Remove on it
  deletes that area's boundary.

  Both halves of that are asserted here, and separately: checking only one could
  look consistent even if both are wrong in the same direction. There is no
  undo, and nothing puts a boundary back.

  So the removal is proved at the database: which separator row went, and which
  books changed plank. A scenario reading only the labels could pass even when
  the removal underneath it is wrong.

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

  Scenario: Every line names the area beneath it
    When I open the app
    And I go to the library
    Then the library should read, top to bottom:
      | 1A                       |
      | New bookcase starts here |
      | 2A                       |
      | New area starts here     |
      | 2B                       |

  Scenario: The line above an area removes that area's boundary
    When I open the app
    And I go to the library
    And I remove the boundary drawn above "2B"

    Then the boundaries recorded for fiction should be:
      | kind  | starts at |
      | shelf | Dune      |

    And the library should show "Dune" on shelf "2A"
    And the library should show "The Dispossessed" on shelf "2A"
    And the library should show "Neuromancer" on shelf "1A"
    And it should say to move exactly:
      | book             | from | to |
      | The Dispossessed | 2B   | 2A |

    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 2B |
    And the catalogue should hold "Dune" recorded as:
      | location | 2A |
    And the catalogue should hold "Neuromancer" recorded as:
      | location | 1A |

    When I go to the library
    Then the library should read, top to bottom:
      | 1A                       |
      | New bookcase starts here |
      | 2A                       |

  Scenario: The first press asks, and backing out changes nothing
    When I open the app
    And I go to the library
    And I press Remove on the boundary drawn above "2B"
    Then I should be asked "2B goes, and its 1 book joins 2A"

    When I keep it
    Then the boundaries recorded for fiction should be:
      | kind  | starts at        |
      | shelf | Dune             |
      | area  | The Dispossessed |
    And the library should show "The Dispossessed" on shelf "2B"
    And it should say to move exactly:
      | book | from | to |
