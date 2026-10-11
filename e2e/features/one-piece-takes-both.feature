Feature: One piece of furniture can take fiction and non-fiction

  A place holds a list of rules, and a book belongs there if it fits any one
  of them. Within one rule, a book has to carry every tag on it. So a bookcase
  that takes fiction and non-fiction holds two rules, one for each, and a rule
  asking for both at once is asking for a book that cannot exist.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title            | author            |
      | Dune             | Frank Herbert     |
      | The Dispossessed | Ursula K. Le Guin |
    And the catalogue already holds these non-fiction books:
      | title                | author           |
      | Rendezvous with Rama | Arthur C. Clarke |
    And a bookcase called "Hall" stands after them, with these shelves:
      |  |
      |  |
    And no other piece says what belongs on it

  Scenario: Fiction or non-fiction, written as two ways of belonging
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Hall"
    And I say "Fiction" belongs here
    And I say "Non-fiction" belongs here as well
    And I ask what would move
    And I write it down
    Then "Hall" should hold these rules:
      | genre/fiction     |
      | genre/non-fiction |
    And every book should belong on "Hall"

  Scenario: A tag added to the same rule is never the other genre
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Hall"
    And I say "Fiction" belongs here
    And I ask to add a tag to that rule
    Then it should not offer the tag "Non-fiction"
    And the screen should say:
      | is not offered here                |
      | no book is both Fiction and Non    |
      | press "Allow something else as well" |

  Scenario: Save does not throw away a rule nobody has written down yet
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Hall"
    And I say "Fiction" belongs here
    And I press "Save"
    Then it should offer to "Write it down"
    And "Hall" should hold no rule
    When I write it down
    Then "Hall" should hold these rules:
      | genre/fiction |
