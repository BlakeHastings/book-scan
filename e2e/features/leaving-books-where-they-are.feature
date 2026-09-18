Feature: Saying never mind to a move leaves every book exactly where it stands

  Applying a plan writes what the rules want and moves nothing. Withdrawing is
  the other half of that sentence, and it moves nothing either: it says the
  rules' answer is not one this person is going to act on. Every book stays on
  the plank the catalogue records it on, the ones somebody already carried keep
  the shelf they were carried to, and what goes is the asking.

  It does not go quietly. The rule that wanted those books is still on that
  place, and only he can decide whether to change it, so the list goes on saying
  what was left, where the rules wanted it, and which rule asked. Silently
  forgetting a decision would be as bad as silently reversing one.

  Background:
    Given the catalogue is empty
    And the catalogue already holds these non-fiction books:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | Dune                 | Frank Herbert     |

  Scenario: The whole list, decided against, and not one book moved
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3
    And I apply the plan
    And I open the list of books to carry
    Then the carry list should say:
      | 4A |
      | 3A |
      | 3 books |

    Given I note where every book stands
    When I leave them where they are

    Then the carry list should say:
      | Nothing is waiting to be carried |
      | Left where they are              |
      | Three books                      |
      | Three on 4A the rules want on 3A |
      | Put them back on the list        |
    And the carry list should not say "Every book is where the rules want it"

    And every book should still stand where it stood

  Scenario: A book already carried keeps the shelf it was carried to
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3
    And I apply the plan

    Given I have already carried "Dune" to "3A"
    And I note where every book stands

    When I open the list of books to carry
    And I leave them where they are

    Then the carry list should say:
      | Nothing is waiting to be carried |
      | Two on 4A the rules want on 3A   |
    And "Dune" should still be recorded on "3A"
    And every book should still stand where it stood

  Scenario: The decision can itself be taken back
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3
    And I apply the plan
    And I open the list of books to carry

    Given I note where every book stands
    When I leave them where they are
    And I put them back on the list

    Then the carry list should say:
      | 4A      |
      | 3A      |
      | 3 books |
    And the carry list should not say "Left where they are"
    And every book should still stand where it stood
