Feature: What the app says is left to do after it moves a boundary

  Two screens answering one question can disagree: the manage screen can say
  "Needs attention (2)" while the first screen says "0 to carry" and the carry
  screen says "Every book is where the rules want it". These scenarios cover the
  other two doors into the same act, the overflow cascade and the boundary move,
  each writing through a different path to the same two lists.

  The two lists are different reads on purpose. The manage screen recomputes
  where every book belongs from the sort order and the furniture; the carry list
  folds the ledger. Only the second can be acted on, and only the second is the
  number on the first screen of the app. So a boundary write that reaches one
  and not the other is a finished job on the screen somebody puts the phone down
  in front of.

  These scenarios walk away mid-flow, which is what makes the gap visible. In
  the intended flow the person carries the book and says so a moment later, and
  the gap closes itself. That is why this was never seen by a scenario that
  finishes what it starts.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | The Dispossessed     | Ursula K. Le Guin |
    And "1A" filled up, so its last book started a new area

  Scenario: A book a full plank pushes along reaches both lists
    Given "1A" filled up and nobody carried the book

    When I open the app
    Then the first screen should say "1" to carry

    When I open that list from the first screen
    Then the carry list should say:
      | Neuromancer |
      | 1A          |
      | 1B          |

    When I open the app
    And I go to the library
    Then the shelves should say "Neuromancer" was last seen on "1A" and belongs on "1B"

    And the catalogue should hold "Neuromancer" recorded as:
      | location | 1A |

  Scenario: A book carried across a boundary reaches both lists
    When I open the app
    And I go to the library
    And I open "Neuromancer" from the library
    And I choose to move it on to "1B"
    And I go back to the book details

    When I go to the library
    Then the shelves should say "Neuromancer" was last seen on "1A" and belongs on "1B"
    And the list should offer to undo the move for "Neuromancer"

    When I open the app
    Then the first screen should say "1" to carry

  Scenario: Taking the move back empties both lists
    When I open the app
    And I go to the library
    And I open "Neuromancer" from the library
    And I choose to move it on to "1B"
    And I go back to the book details

    When I go to the library
    And I undo the move for "Neuromancer"
    Then nothing should need attention

    When I open the app
    Then the first screen should say "0" to carry
