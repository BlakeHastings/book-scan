Feature: A cascade reaching a plank that holds one book

  A plank holding one book gives that book up like any other. It used to refuse,
  saying "1B holds only one book, so moving it along would just empty the shelf.
  Put the new book on the next shelf instead", which is an instruction with no
  button behind it: the two answers on screen were "yes it fit", about a move
  nobody had made, and "no, 1B is full too", which said the same sentence again.

  Emptying the plank is the point. What the person needs is a gap on the plank
  the book in their hand belongs on, and where that plank holds one book the gap
  is the whole plank. `docs/shelving.md` allows the only book in an area to leave
  it, and says a boundary moved by hand and an automatic shuffle must write the
  same thing down, differing only at the ends of the run.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | The Dispossessed     | Ursula K. Le Guin |
      | Snow Crash           | Neal Stephenson   |
    # Once, so Stephenson is alone on 1B and Clarke, Gibson and Le Guin are
    # left on 1A.
    And "1A" filled up, so its last book started a new area

  Scenario: The one book on it moves along, and the chain walks on
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

    When I say there is no room on the shelf
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"

    # The rung this feature exists for. 1B holds Snow Crash and nothing else.
    When I say there is no room on that one either
    Then it should ask me to move "Snow Crash" from "1B" to "1C"
    And it should say I am placing "Snow Crash", 2 books deep
    # Still nothing moved: a proposal is not an observation.
    And the bookcase should still show "Snow Crash" on "1B"

    When I say the moved book fitted
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"
    And the catalogue should hold "Snow Crash" recorded as:
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

    And the catalogue should hold "Dune" recorded as:
      | location | 1A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |

    # Every book went where the app said and the app wrote every one down, so
    # the record and the room agree.
    And I go to the library
    And nothing should need attention
