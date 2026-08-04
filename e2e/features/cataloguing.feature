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
      | Title                     | Dune          |
      | Authors (comma separated) | Frank Herbert |
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
      | is_fiction    | 1                            |
      | publisher     | Ace Books                    |
      | lookup_source | Open Library + Google Books  |
    And the photograph of "Dune" should be on disk
    And the library should show "Dune" on shelf "1A"
