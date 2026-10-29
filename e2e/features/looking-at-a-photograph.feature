Feature: Looking at a book's photographs

  The photographs are taken at the camera's full size and kept that way, for
  the reading and for anybody who wants to look closely. Everywhere a picture
  is drawn smaller than that, the phone downloads a copy the size it is drawn,
  because a camera photograph is megabytes and a phone on a slow line waits for
  every one of them.

  A cover is drawn the shape of a book, taller than it is wide, and pressing a
  photograph opens it over the whole screen. It closes the way anything over
  the screen does: a tap, the button that says so, or the phone's back gesture.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"

  Scenario: A book's photographs are book shaped, small until asked, and open whole
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph all three sides of the book
    Then the camera should recognise the book as "Dune"
    And all three photographs should have been read

    When I review what it found
    And I confirm the details and go to shelve it
    And I say it fits and save it
    And I start counting the photographs downloaded
    And I go to the library
    And I open "Dune" from the library
    And I start editing the details
    Then every photograph drawn should be a copy rather than the original
    And every photograph of the book should be drawn taller than it is wide

    When I press a photograph of the book
    Then it should be open over the whole screen
    When I press "Close" on it
    Then it should no longer be open

    When I press a photograph of the book
    And I use the back gesture
    Then it should no longer be open
    And "Save changes" should still be on the screen

    When I press a photograph of the book
    And I tap the picture once
    Then it should no longer be open
