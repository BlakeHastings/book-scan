Feature: A cascade asks at every plank, shows each move, and makes none of them early

  Saying a plank is full takes its last book off and sends it to the plank
  after it, and whether it fits there is a question only the person standing at
  the shelf can answer. So a full bookcase leaves a stack of books in the air,
  and each one is a separate physical observation.

  Books are different thicknesses, so a yes at the bottom of the stack does not
  settle every move above it: the stack unwinds one book at a time, and a no on
  the way out descends again. Nothing moves until somebody says they moved it,
  and every level asks the same question and gets the same picture.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | The Dispossessed     | Ursula K. Le Guin |
      | Snow Crash           | Neal Stephenson   |
      | Roadside Picnic      | Arkady Strugatsky |
      | The Book Thief       | Markus Zusak      |
    And the areas filled up in this order:
      | 1A |
      | 1A |
      | 1A |

  Scenario: Every displaced book is asked about again, and a no descends again
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    Then the shelf drawing should be labelled "1A"
    And the first answer should read "No room, move one along"

    When I say there is no room on the shelf
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"
    And it should draw the gap for "The Dispossessed" on "1B"
    And the bookcase should still show "The Dispossessed" on "1A"

    When I say there is no room on that one either
    Then it should ask me to move "The Book Thief" from "1B" to "1C"
    And it should say I am placing "The Book Thief", 2 books deep
    And it should draw the gap for "The Book Thief" on "1C"
    And the bookcase should still show "The Book Thief" on "1B"
    And the bookcase should still show "The Dispossessed" on "1A"

    When I say the moved book fitted
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"

    And the bookcase should still show "The Book Thief" on "1C"
    And the bookcase should still show "The Dispossessed" on "1A"
    And the catalogue should hold "The Book Thief" recorded as:
      | location | 1C |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1A |

    When I say there is no room on that one either
    Then it should ask me to move "Roadside Picnic" from "1B" to "1C"
    And it should say I am placing "Roadside Picnic", 2 books deep

    When I say the moved book fitted
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"
    And the catalogue should hold "Roadside Picnic" recorded as:
      | location | 1C |

    When I say the moved book fitted
    Then it should tell me to put "Dune" in the gap at "1A"

    When I say it fits and save it
    Then the catalogue should be filed in this order:
      | Rendezvous with Rama |
      | Neuromancer          |
      | Dune                 |
      | The Dispossessed     |
      | Snow Crash           |
      | Roadside Picnic      |
      | The Book Thief       |

    And the catalogue should hold "Dune" recorded as:
      | location | 1A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |

    And I go to the library
    And nothing should need attention

  Scenario: Walking away leaves the shelves exactly as they were
    Nothing was carried, so nothing should have moved.

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    And I say there is no room on the shelf
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"

    When I say there is no room on that one either
    Then it should ask me to move "The Book Thief" from "1B" to "1C"

    When I go back to the book details
    Then the bookcase should still show "The Dispossessed" on "1A"
    And the bookcase should still show "The Book Thief" on "1B"
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1A |
    And the catalogue should hold "The Book Thief" recorded as:
      | location | 1B |

    When I go to the library
    Then nothing should need attention

  Scenario: A book carried before walking away stays carried
    The other half of the same rule. Somebody who confirmed a move made it, so
    it is on the shelves and in the catalogue whatever they do next.

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    And I say there is no room on the shelf
    And I say there is no room on that one either
    Then it should ask me to move "The Book Thief" from "1B" to "1C"

    When I say the moved book fitted
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"

    When I go back to the book details
    Then the bookcase should still show "The Book Thief" on "1C"
    And the catalogue should hold "The Book Thief" recorded as:
      | location | 1C |
    And the bookcase should still show "The Dispossessed" on "1A"
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1A |

  Scenario: The shuffle already made is still on screen when you come back
    `Cascade.done` is append only, because a book that was physically carried
    was physically carried.

    What does not come back is the question. Nothing moved for it and nobody has
    looked at those shelves since, so the way back in is the placing question
    asked again, with the record of what was carried underneath it.

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    And I say there is no room on the shelf
    And I say there is no room on that one either
    Then it should ask me to move "The Book Thief" from "1B" to "1C"

    When I say the moved book fitted
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"

    When I go back to the book details
    And I confirm the details and go to shelve it
    Then the shuffle should still list "The Book Thief" carried from "1B" to "1C"
    And it should not ask me to move any other book
    And it should tell me to put "Dune" in the gap at "1A"
