Feature: Saying never mind to a move leaves every book exactly where it stands

  The owner tidied up his shelves, applied a plan, and ended with forty-six books
  the app wanted him to walk across a room. He was not going to. "I can't say
  'don't move them, put them back'. I just need to reset the locations of the
  books back to their shelves." There was no way to withdraw the intention, so
  the list asked forever and the only exits were to carry them or to look at it
  (#402).

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

    # The list empties, and says who emptied it. "Every book is where the rules
    # want it" would be the rules agreeing; this is a person having answered
    # them, and the card underneath says what was answered and by which rule.
    Then the carry list should say:
      | Nothing is waiting to be carried |
      | Left where they are              |
      | Three books                      |
      | Three on 4A the rules want on 3A |
      | Put them back on the list        |
    And the carry list should not say "Every book is where the rules want it"

    # In the database, because this is the half a screen cannot answer: a list
    # that emptied by moving books draws exactly like one that emptied honestly.
    And every book should still stand where it stood

  Scenario: A book already carried keeps the shelf it was carried to
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 4"
    And I ask to move these books to bookcase 3
    And I apply the plan

    # Partly carried is the normal case: he walked one of them across before he
    # changed his mind.
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

    # Back on the list it left, off the same plank, going to the same one. A
    # withdrawal somebody could not withdraw would be the one-way door this
    # whole change exists to remove, one door along.
    Then the carry list should say:
      | 4A      |
      | 3A      |
      | 3 books |
    And the carry list should not say "Left where they are"
    And every book should still stand where it stood
