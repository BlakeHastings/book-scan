@front-camera
Feature: Recognising a book somebody has already scanned

  Three people work one pile: one photographs, one resolves details, one
  shelves. So a book can easily be photographed, put back on the pile, and
  picked up again by whoever comes next. Until this, holding it up matched
  nothing at all, because the cover comparison only ever looked at books
  already on a shelf, and the book went round the queue a second time.

  Two rows for one book end badly in both directions: catalogued twice, or
  discarded along with the photographs of the real one. So the answer is not a
  row on the shortlist but its own panel, and what it offers is the capture
  somebody already started rather than a second one.

  The camera here is pointed at a front cover, not a back. That is the whole
  situation: a back cover carries a barcode, and a barcode settles what the
  book is before any of this is reached.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the camera is pointed at the front cover of "Dune"

  Scenario: A book already in the queue is offered, not scanned again
    When I open the app
    And I start the camera
    And I photograph the front of the book
    And I send it to the queue
    Then the queue should hold one book

    # Somebody else picks the same book off the pile and holds it up.
    When I go back to the start
    And I scan the book
    Then it should say the book is already in the queue

    When I open the book it found in the queue
    Then the review screen should be showing a queued book

    # And still only ever one book. The point of the answer is that a second
    # capture was never made.
    And the queue should hold one book

  Scenario: The answer can be turned down, and scanning carries on
    When I open the app
    And I start the camera
    And I photograph the front of the book
    And I send it to the queue
    And I go back to the start
    And I scan the book
    Then it should say the book is already in the queue

    # A wrong answer with no way past it is worse than no answer: the person
    # would photograph the book again to escape it, which is the thing this
    # exists to prevent.
    When I say it is a different book
    Then it should stop saying the book is already in the queue
    And the camera should still be ready to scan
