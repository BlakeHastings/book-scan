Feature: A bookcase somebody has named is still checked

  Naming a piece of furniture is what the furniture screens are for, and it is
  the first thing the owner asked for. It moves nothing: every area keeps its
  id, every book keeps the area it was placed in, and the only thing that reads
  differently is the label, which is derived from the name.

  The day a bookcase was first given a name, that stopped being true of the one
  check that exists to notice a book in the wrong place. Two functions render a
  label for one plank, the ledger's and the layout's, and the check compared
  their output as strings: it could read one side and not the other, dropped 181
  of 238 books as unreadable, and answered an empty list. An empty list reads as
  "everything is fine", and books get carried around a house on the strength of
  it (#356).

  So this is the whole journey with a name on the bookcase: a book put down, a
  boundary moved and not acted on, the disagreement reported in the words a
  person would use, and the walk recorded. Every label here is a phrase because
  the piece has a name, and not one of them decides anything.

  Background:
    Given the catalogue is empty
    And bookcase 1 is called "Hall shelf"
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |
      | The Dispossessed     | Ursula K. Le Guin |
    And "1A" filled up, so its last book started a new area

  Scenario: A book left behind by a moved boundary is reported, and the walk is recorded
    # The Background is already half the claim. Saving a book records the plank
    # the layout named it at, and a named piece used to answer to no such plank,
    # so every one of these books would have been catalogued with nowhere to be.
    When I open the app
    And I go to the library
    Then nothing should need attention
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | Hall shelf · A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | Hall shelf · B |

    # #359. This button used to say "Move it on to 1B" on the same screen that
    # said the book's own plank was "Hall shelf · B": two names for one plank,
    # and the one on the button was also the key the app sent to move the book.
    When I open "Dune" from the library
    Then the book should offer to move it:
      | Move it on to Hall shelf · B |

    # The boundary moves and nobody carries anything, which is the disagreement
    # the list exists for. Said in the words the piece has been given.
    When I choose to move it on to "Hall shelf · B"
    And I go back to the book details
    Then the book should say it was last seen on "Hall shelf · A" and now belongs on "Hall shelf · B"

    # And the walk goes down against the plank rather than against its name.
    When I say I have moved it
    Then the shelf drawing should draw "Dune" in place on "Hall shelf · B"

    When I go to the library
    Then nothing should need attention
    And the catalogue should hold "Dune" recorded as:
      | location | Hall shelf · B |
