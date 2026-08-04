Feature: A book that belongs at the end of a full area

  Nothing can predict whether a plank will take another book, so the person is
  the sensor and says when it will not. What happens next depends on where in
  the plank the book belongs.

  If it belongs at the end, the book in their hand is the one that moves: it
  goes to the start of the next plank and nothing already shelved is touched.
  The app used to reach for the cascade here and ask them to pull the last book
  off the plank and carry it next door instead, which produces the same
  ordering by handling two books rather than one.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | The Dispossessed     | Ursula K. Le Guin |
    And "1A" filled up, so its last book started a new area

  Scenario: The book being placed moves, and nothing on the bookcase does
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    # Clarke and Gibson are on 1A, Le Guin is on 1B, and Herbert files after
    # Gibson, so nothing on 1A goes after the book in hand.
    Then the shelf drawing should be labelled "1A"
    And it should tell me to put "Dune" in the gap at "1A"
    # The screen says which of the two jobs it is offering before it is tapped.
    And the first answer should read "No room, put it on the next area"

    When I say there is no room on the shelf
    # Not "take Neuromancer off the end of 1A". Neuromancer stays where it is.
    Then it should tell me the book itself goes on to "1B"
    And it should not ask me to move any other book
    And it should tell me to put "Dune" in the gap at "1B"

    When I say it fits and save it
    Then the catalogue should be filed in this order:
      | Rendezvous with Rama |
      | Neuromancer          |
      | Dune                 |
      | The Dispossessed     |

    # The one that was being asked to move for no reason.
    And the catalogue should hold "Neuromancer" recorded as:
      | location | 1A |
    And the catalogue should hold "Dune" recorded as:
      | location | 1B |

    # It went where the app said, so the record and the room agree.
    And I go to the library
    And nothing should need attention
