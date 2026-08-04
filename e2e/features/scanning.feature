Feature: Scanning a book that is already catalogued

  There is one way in for a book the catalogue already has. Hold it up to the
  camera and it opens the book, and the book's own page offers whatever its
  current state allows: one on the bookcase can come off, one that is off can
  go back. The person chooses. That is what makes a single entry point work,
  where two tiles for the same camera pointed in opposite directions made you
  decide what you were doing before you had picked the book up.

  Scanning writes nothing. This is checked against the database rather than the
  screen, and it is the whole point of the scenarios below: identification is
  a guess with a good record, not a fact, and it is not allowed to act on its
  own against a catalogue nobody can rebuild. A wrong write here costs an
  afternoon of re-photographing; a wrong page costs a tap.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title | author        |
      | Dune  | Frank Herbert |

  Scenario: A book on the bookcase is opened, and comes off only when asked
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I scan the book
    Then it should open the book "Dune"
    And the catalogue should record "Dune" as on the bookcase
    And the book should offer:
      | Check out    |
      | Edit details |
      | Scan another |

    When I check it out
    Then the catalogue should record "Dune" as off the bookcase
    And the book should offer:
      | Check in     |
      | Edit details |
      | Scan another |

  Scenario: A book that is off the bookcase goes back through the shelving step
    Given the camera is pointed at the back cover of "Dune"
    And "Dune" is off the bookcase
    When I open the app
    And I scan the book
    Then it should open the book "Dune"

    # Scanning it did not put it back. Nothing does that but the person.
    And the catalogue should record "Dune" as off the bookcase

    When I check it in
    Then it should tell me to put "Dune" in the gap at "1A"

    When I say it fits and put it back
    Then the catalogue should record "Dune" as on the bookcase
