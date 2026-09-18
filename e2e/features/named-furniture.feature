Feature: A bookcase somebody has named is still checked

  Naming a piece of furniture is what the furniture screens are for, and it is
  the first thing the owner asked for. It moves nothing: every area keeps its
  id, every book keeps the area it was placed in, and the only thing that reads
  differently is the label, which is derived from the name.

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
    When I open the app
    And I go to the library
    Then nothing should need attention
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | Hall shelf · A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | Hall shelf · B |

    When I open "Dune" from the library
    Then the book should offer to move it:
      | Move it on to Hall shelf · B |

    When I choose to move it on to "Hall shelf · B"
    And I go back to the book details
    Then the book should say it is supposed to be moved

    When I press the notice about moving it
    Then the shelf drawing should be labelled "Hall shelf · B"

    When I say it fits and finish the move

    When I go to the library
    Then nothing should need attention
    And the catalogue should hold "Dune" recorded as:
      | location | Hall shelf · B |
