Feature: Placement can be started over from Settings

  Taking every book off its shelf is one press in Settings, behind a phrase
  typed out in full. Pinned books come off too. Nothing is deleted: each book
  gains one row saying it was taken off, and the books themselves, their tags
  and the furniture are all left as they were.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |
      | The Dispossessed     | Ursula K. Le Guin |
    And "Dune" is pinned where it stands
    And I have noted the placement history

  Scenario: Every book comes off its shelf, the pinned one too, and the history is kept
    When I open the app
    And I open the settings
    Then the settings should say "3 books will be taken off their shelves, 1 of them pinned."
    And I should not be offered to "Remove all the furniture"

    When I ask to "Take every book off its shelf"
    Then it should not let me "Take every book off its shelf" until I type "unplace every book"

    When I type "unplace every book" and "Take every book off its shelf"
    Then the settings should say "Done. 3 books taken off the shelves."
    And the settings should say "No book is on a shelf."
    And no shelved book should be on a plank
    And the placement history should have kept every row and gained:
      | title                | kind       | actor  |
      | Dune                 | checked_in | person |
      | Rendezvous with Rama | checked_in | person |
      | The Dispossessed     | checked_in | person |
    And "Dune" should still carry the tag "genre/fiction"
