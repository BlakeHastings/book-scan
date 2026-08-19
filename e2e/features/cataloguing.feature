Feature: Cataloguing a book from its cover

  Photograph the back of a book. The app reads the barcode, looks the ISBN up,
  and shows what it found. Confirm it, say it went on the shelf, and the book
  is in the catalogue with its photograph.

  This is the whole reason the app exists, so it is checked all the way down:
  not only that the right title appears on screen, but that the row written to
  the database has the right ISBN, the right filing name and the right shelf,
  and that the photograph really is on disk.

  How the ISBN was read is part of the record. A barcode is self-validating and
  an OCR reading is a guess the catalogue happened to agree with, so a book that
  cannot say which it was has lost something a catalogue meant to last should
  keep. The camera opens on the back cover, which carries the barcode, so this
  book is read from one.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"

  Scenario: A photographed book reaches the catalogue
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    Then the review screen should show:
      | Title  | Dune          |
      | Author | Frank Herbert |
    And the ISBN should read "9780441013593"
    And the ISBN should say it was read from "barcode"

    When I confirm the details and go to shelve it
    Then it should tell me to put "Dune" in the gap at "1A"
    And the placement should read "First book in fiction. Start at 1A."

    When I say it fits and save it
    Then the catalogue should hold "Dune" recorded as:
      | isbn13        | 9780441013593                |
      | isbn10        | 0441013597                   |
      | isbn_source   | barcode                      |
      | title         | Dune                         |
      | authors       | Frank Herbert                |
      | author_filing | Herbert, Frank               |
      | shelf_range   | fiction                      |
      | publisher     | Ace Books                    |
      | lookup_source | Open Library + Google Books  |
    And the photograph of "Dune" should be on disk
    And the library should show "Dune" on shelf "1A"

  Scenario: The next photograph does not land on the book just shelved
    Shelving a book finishes with it. Until #431 it did not: the shelving step
    kept the book in hand so that the screen after it could say where the book
    went, and every other way off that screen carried it along. The tab bar is
    on that screen, and pressing Scan is what somebody with the next book
    already in their hands does.

    So the camera reopened holding a book that was on a shelf, three of three
    and thumbnails and all, and the obvious press of the shutter attached the
    next book's photograph to it. A different book's picture became its spine,
    which is the picture the bookcase view draws, and the slot it replaced came
    back out of the reading. The screen said "reading", which is what it says
    when a photograph lands on the right book.

    That is why this is asserted against the database and not against the
    screen. All three sides are photographed so that there is a spine to lose.

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph all three sides of the book
    Then the camera should recognise the book as "Dune"
    And all three photographs should have been read

    When I review what it found
    And I confirm the details and go to shelve it
    And I say it fits
    And I note the photographs of "Dune"

    # Press Scan, press Start camera. The book is on a shelf, so the hands are
    # empty and the next press of the shutter starts a new book.
    And I start the camera
    Then nothing should be in hand

    When I press the shutter
    # A capture of its own, which is the whole of it: the photograph went to a
    # new book rather than on to the finished one.
    Then the queue should hold one book
    And the photographs of "Dune" should be untouched
    And the catalogue should be filed in this order:
      | Dune |
