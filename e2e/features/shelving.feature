Feature: Putting a book on a shelf that is already full

  The app's distinguishing trick is that it does not just record a book, it
  tells you where on the shelf it physically goes: between which two books, on
  which plank of which bookcase.

  Nothing can predict whether a shelf will actually take another book, because
  that depends on how thick the ones already on it are. So the person is the
  sensor. When they say there is no room, the app takes one book off the end of
  that shelf, tells them where to put it, and asks again. That shuffle is what
  this covers, and it is checked against the database because a shuffle the app
  described but did not record would leave the shelf and the catalogue
  disagreeing.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | The Dispossessed     | Ursula K. Le Guin |

  Scenario: A full shelf shuffles its last book along to make room
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    Then the placement should read "1A: between Rendezvous with Rama (Clarke, Arthur C.) and The Dispossessed (Le Guin, Ursula K.)"
    And the shelf drawing should be labelled "1A"

    # Dune files between the two books on 1A, so the gap is in the middle and a
    # book genuinely has to come off the end to open it.
    And the first answer should read "No room, move one along"

    When I say there is no room on the shelf
    Then it should ask me to move "The Dispossessed" from "1A" to "1B"
    And a new area should be recorded for fiction, starting at "The Dispossessed"

    When I say the moved book fitted
    Then it should tell me to put "Dune" in the gap at "1A"

    When I say it fits and save it
    Then the catalogue should be filed in this order:
      | Rendezvous with Rama |
      | Dune                 |
      | The Dispossessed     |
    And the library should show "Dune" on shelf "1A"
    And the library should show "The Dispossessed" on shelf "1B"

    # The book the shuffle displaced was carried to 1B on the app's own
    # instruction and confirmed. If that is not written down, the library turns
    # round and reports the move as still outstanding.
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |
    And nothing should need attention

  Scenario: A book put back where the app said is not then reported as misfiled
    Books come off the shelves and go back on again, and the shelves move
    underneath them while they are off. Putting one back is the app telling
    somebody a shelf and being told the book fits, which is an observation
    about the room and the only thing allowed to change where the catalogue
    thinks a book is.

    Given "The Dispossessed" was last recorded at "2A"
    And "The Dispossessed" is off the bookcase

    When I open the app
    And I go to the library
    And I open "The Dispossessed" from the off-bookcase list
    And I put it back on the bookcase
    Then it should tell me to put "The Dispossessed" in the gap at "1A"

    When I say it fits and save it
    And I go to the library
    Then the catalogue should hold "The Dispossessed" recorded as:
      | location | 1A |
    And nothing should need attention
