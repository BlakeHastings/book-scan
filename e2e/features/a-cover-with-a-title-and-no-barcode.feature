@front-camera
Feature: A book with no barcode is found by the title on its cover

  Plenty of books on a shelf have no barcode: anything older than the ISBN,
  and anything whose back has been covered or torn. The front cover still
  carries the title and the author, and the queue reads those off it.

  What it read used to go nowhere. Review said no catalogue had answered when
  none had been asked, and left the title and author empty for somebody to
  type in while the reading sat quoted underneath them. Now the queue looks
  the title and author up, and review asks whether the book it found is the
  one in hand. It asks rather than fills: a book with the same title by
  somebody else is a different book, and only the person holding it can say.

  The camera here is pointed at a front cover, which carries no barcode.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the camera is pointed at the front cover of "Dune"

  Scenario: The book the title finds is offered, and saying yes fills it in
    When I open the app
    And I start the camera
    And I photograph the front of the book
    And I finish with the book without an ISBN
    Then review should ask whether it is "Dune" by "Frank Herbert"
    And the review screen should show:
      | Title  |  |
      | Author |  |

    When I say that is the book it found
    Then the review screen should show:
      | Title  | Dune          |
      | Author | Frank Herbert |

    When I confirm the details and go to shelve it
    And I say it fits and save it
    Then the catalogue should hold "Dune" recorded as:
      | title         | Dune                |
      | authors       | Frank Herbert       |
      | author_filing | Herbert, Frank      |
      | shelf_range   | fiction             |
      | publisher     | Ace Books           |
      | lookup_source | Open Library search |
      | isbn13        |                     |

  Scenario: When the title finds nothing, review starts from what the cover reads
    Given no source can name "Dune"
    When I open the app
    And I start the camera
    And I photograph the front of the book
    And I finish with the book without an ISBN
    Then review should not ask whether it is any book
    And the review screen should show:
      | Title  | Dune          |
      | Author | Frank Herbert |
    And review should say the title and author were read off the cover
