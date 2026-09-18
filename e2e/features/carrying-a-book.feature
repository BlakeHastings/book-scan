Feature: Doing what the app asks satisfies the app

  The trip names one plank; the placing screen works out where the book belongs
  from the rules rather than from where the trip is taking it. With a second
  piece of furniture claiming the same tag, those two questions can have two
  different answers.

  Two pieces claiming one tag is legitimate: it is a room somebody is
  rearranging. The carry flow tells the placing screen where the walk goes, and
  the placing screen is still the one a newly scanned book gets.

  Nothing here rewrites where a book is: the book is wherever the person put it.
  What matters is what the app asks for next.

  Background:
    Given the catalogue is empty
    And the catalogue already holds these non-fiction books:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Neuromancer          | William Gibson    |
      | Dune                 | Frank Herbert     |
    And a bookcase called "Landing shelves" stands first, with these shelves:
      | Top |
    And "Landing shelves" is for non-fiction as well

  Scenario: The plan, the list and the screen name one plank
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 5"
    And I ask to move these books to bookcase 3
    Then the plan should say:
      | 5A to 3A |

    When I apply the plan
    And I open the list of books to carry
    Then the carry list should say:
      | 5A      |
      | 3A      |
      | 3 books |

    When I start the first trip
    And I take the books off the shelf
    Then it should tell me to put "Rendezvous with Rama" in the gap at "3A"

  Scenario: Every book carried comes off the list, and is where the app said
    When I open the app
    And I open my fixtures
    And I open the bookcase called "Bookcase 5"
    And I ask to move these books to bookcase 3
    And I apply the plan
    And I open the list of books to carry
    And I start the first trip
    And I take the books off the shelf
    And I say each book fits

    Then the screen should say:
      | Carried               |
      | Three books are on 3A |
      | 3 books               |

    And it should offer to "That is everything"

    And "Rendezvous with Rama" should be standing on "3A"
    And "Neuromancer" should be standing on "3A"
    And "Dune" should be standing on "3A"
