Feature: The gap is on screen wherever on the plank it falls

  A plank holds more books than fit across a phone, so the drawn shelf is a row
  that scrolls, and where it comes to rest is the answer to the only question
  the shelving step asks. Somebody is standing at a bookcase with a book in
  their hand, looking for the hole. If the hole is off the side of the screen
  the step has quietly stopped answering and they go hunting for it.

  Reported from real use on a phone (#119) for the case where the book belongs
  before everything already on the plank. The far end and the middle are here
  as well, because they are served by the same effect and the far end is the
  more common of the three.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"

  Scenario: The book belongs before everything already on the plank
    # Dune files under Herbert, and every book on the plank files after it, so
    # the gap opens at the very start of the row.
    Given 12 more books are on the shelves, all filing after "Dune"

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    Then the shelf drawing should be labelled "1A"
    And the shelf drawing should be longer than the screen
    And the gap should be on screen without scrolling the shelf

  Scenario: The book belongs after everything already on the plank
    Given 12 more books are on the shelves, all filing before "Dune"

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    Then the shelf drawing should be labelled "1A"
    And the shelf drawing should be longer than the screen
    And the gap should be on screen without scrolling the shelf

  Scenario: The book belongs in the middle of the plank
    Given 12 more books are on the shelves, all filing before "Dune"
    And 12 more books are on the shelves, all filing after "Dune"

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    Then the shelf drawing should be labelled "1A"
    And the shelf drawing should be longer than the screen
    And the gap should be on screen without scrolling the shelf
