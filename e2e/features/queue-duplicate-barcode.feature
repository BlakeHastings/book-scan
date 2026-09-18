Feature: Photographing a book whose barcode is already in the queue

  The door people actually use. Somebody working through a stack of new books
  is in the Add flow with the camera on the back cover, and the back cover is
  where the barcode is, so this is the entry point where a book gets scanned
  twice most often.

  Deliberately the ordinary back cover camera, and deliberately not tagged for
  the front cover one. A barcode is what this scenario is about: the ISBN is
  exact evidence and it is what settles the question here, where the cover
  comparison is what is left when nothing can be read.

  Nothing is blocked. Two copies of one book genuinely turn up, so the second
  scenario is as load bearing as the first: the answer can be turned down, and
  the capture just taken is kept.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the camera is pointed at the back cover of "Dune"

  Scenario: The second photograph of a queued barcode offers the first capture
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I start the next book
    And I photograph the book
    Then it should say the book is already in the queue

    When I open the book it found in the queue
    Then the review screen should be showing a queued book

    And the queue should hold one book

  Scenario: Saying it is a different book keeps the second capture
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I start the next book
    And I photograph the book
    Then it should say the book is already in the queue

    When I say it is a different book
    Then it should stop saying the book is already in the queue
    And the queue should hold 2 books
