Feature: Doing what the app asks satisfies the app

  The owner ended a hunting pass with a hundred and forty-two books he could not
  carry. He was told to take a book off one shelf and put it on another; the
  screen he then stood in front of told him to put it back where it already was;
  he did what it said; and the same trip appeared again. Forever. The finished
  screen told him one book was on 3A while drawing 3A with nothing on it, and the
  number of books still to carry never moved (#429).

  Three symptoms and one defect. The trip named one plank and the placing screen
  worked out another, because it was asking where the book belongs *now*, from
  the rules, rather than being told where this trip was taking it. With a second
  piece of furniture claiming the same tag, those two questions have two answers,
  and doing what the app asked never satisfied it.

  Two pieces claiming one tag is legitimate. It is a room somebody is
  rearranging, and it is not what is being fixed here: it is what made the two
  answers visible. What is fixed is that the carry flow now tells the placing
  screen where the walk goes, and the placing screen is still the one a newly
  scanned book gets.

  Nothing here rewrites where a book is. The book is wherever the person put it;
  what was wrong was what the app asked for next.

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

    # The third answer, which used to be a plank on the piece standing first.
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

    # The finished screen, which said this over a drawing of an empty plank.
    Then the screen should say:
      | Carried               |
      | Three books are on 3A |
      | 3 books               |

    # And there is nothing left, which is the whole of the loop being closed. A
    # trip that came back would put "Next: three books off Landing shelves · Top"
    # here instead.
    And it should offer to "That is everything"

    # In the database, because a screen that has correctly stopped asking draws
    # exactly like one that is lying about where the books went.
    And "Rendezvous with Rama" should be standing on "3A"
    And "Neuromancer" should be standing on "3A"
    And "Dune" should be standing on "3A"
