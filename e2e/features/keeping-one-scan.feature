Feature: Keeping one of two scans of the same book

  Somebody cataloguing a pile on a phone photographs a book, loses track, and
  photographs it again. Two rows that look the same leave her guessing which one
  to shelve and which to throw away. So the queue draws every scan of one ISBN
  together, says how many there are, and keeping one sends the others the way a
  swipe does: held, with a way back, and gone once she moves on.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the camera is pointed at the back cover of "Dune"

  Scenario: Two scans of one book are one group, and keeping one leaves one
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I start the next book
    And I photograph the book
    Then it should say the book is already in the queue

    When I say it is a different book
    Then the queue should hold 2 books

    When I go to the queue
    Then the queue should show one group of 2 scans of "Dune"

    When I keep one of the scans
    Then the other scan should say it is being discarded

    When I leave by the "Library" tab
    Then the queue should come to hold 1 books
