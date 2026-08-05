Feature: A cascade asks at every plank, shows each move, and makes none of them early

  Saying a plank is full takes its last book off and sends it to the plank
  after it, and whether it fits there is a question only the person standing at
  the shelf can answer. So a full bookcase leaves a stack of books in the air,
  and each one is a separate physical observation.

  Three things had been running together, and the owner reported all three from
  the room:

  #110  A yes at the bottom of the stack settled every move above it, on the
        reasoning that each was only waiting for room below. Books are
        different thicknesses, so that is false of a real shelf. The stack
        unwinds one book at a time, and a no on the way out descends again.
  #111  The boundary shifted the moment a step was proposed, so the book left
        the plank before anybody touched it, and stayed gone if they walked
        away. Nothing moves until somebody says they moved it.
  #112  Each step was described in a sentence. Every level is the same
        question as the first one, so every level gets the same picture.

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
    # Three times, so 1B ends up with three books on it and can be asked twice.
    # Clarke, Gibson and Le Guin are left on 1A.
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
    # Herbert files between Gibson and Le Guin, so the gap is in the middle of
    # 1A and a book genuinely has to come off the end to open it.
    Then the shelf drawing should be labelled "1A"
    And the first answer should read "No room, move one along"

    # Down one. The step is drawn, not described: 1B as it will look, with the
    # gap at its start and Le Guin's name on the spine hanging under it.
    When I say there is no room on the shelf
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"
    And it should draw the gap for "Le Guin, Ursula K." on "1B"
    # And nothing has happened. Le Guin is still on the plank she was on.
    And the bookcase should still show "The Dispossessed" on "1A"

    # Down two.
    When I say there is no room on that one either
    Then it should ask me to move "The Book Thief" from "1B" to "1C"
    And it should say I am placing "The Book Thief", 2 books deep
    And it should draw the gap for "Zusak, Markus" on "1C"
    And the bookcase should still show "The Book Thief" on "1B"
    And the bookcase should still show "The Dispossessed" on "1A"

    # Up one. The yes belongs to The Book Thief and nobody has yet said
    # anything about The Dispossessed, which is still in hand.
    When I say the moved book fitted
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"

    # One move made, one move recorded, and nothing claimed about the other.
    And the bookcase should still show "The Book Thief" on "1C"
    And the bookcase should still show "The Dispossessed" on "1A"
    And the catalogue should hold "The Book Thief" recorded as:
      | location | 1C |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1A |

    # Down again, from where the answer was no. Same question, same route: the
    # last book comes off 1B and goes to 1C, exactly as the first no did.
    When I say there is no room on that one either
    Then it should ask me to move "Roadside Picnic" from "1B" to "1C"
    And it should say I am placing "Roadside Picnic", 2 books deep

    # Up one, and this time 1B has room.
    When I say the moved book fitted
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"
    And the catalogue should hold "Roadside Picnic" recorded as:
      | location | 1C |

    # Up to the book in hand, which is only reached once every book the shuffle
    # displaced has been carried and written down.
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

    # Every book went where the app said and the app wrote down every one, so
    # the record and the room agree.
    And I go to the library
    And nothing should need attention

  Scenario: Walking away leaves the shelves exactly as they were
    Nothing was carried, so nothing should have moved. The boundary used to
    shift as soon as a step was proposed, which took the book off the plank on
    screen and left it off for good if the person backed out (#111).

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
    # And the one still in the air was never claimed to have moved.
    And the bookcase should still show "The Dispossessed" on "1A"
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1A |
