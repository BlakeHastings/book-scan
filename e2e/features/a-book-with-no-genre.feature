Feature: A book nobody has called fiction or non-fiction is asked about where it is shelved

  Every rule that says where a book goes starts from whether it is fiction or
  non-fiction. A book typed in by hand, because no catalogue knew it, carries
  neither, and review lets it through without one. The shelving screen used to
  answer that with a sentence saying placement needed a title and author (it
  had both), three buttons that could not be pressed, and an instruction to go
  back two screens.

  So the question is asked where somebody is standing with the book: two
  answers, and then the shelf.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | The Dispossessed     | Ursula K. Le Guin |

  Scenario: The question is answered on the shelving screen and the book is shelved
    Given no source can name "Dune"
    And the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    And I review what it found
    And I set "Title" to "Dune"
    And I set "Author" to "Frank Herbert"
    And I confirm the details and go to shelve it
    Then it should ask whether the book is fiction or non-fiction

    When I say here that it is "Fiction"
    Then the placement should read "Shelf 1A, between Clarke and Le Guin"
    And the sentence about where it goes should sit inside the page, below the header

    When I say it fits and save it
    Then the catalogue should have "Dune" tagged:
      | Fiction | person |
    And the library should show "Dune" on shelf "1A"
