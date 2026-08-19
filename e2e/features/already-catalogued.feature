Feature: Photographing a book that is already on a shelf

  The catalogue already holds this book. Somebody has picked it up off a pile
  and is photographing it a second time, which is how a collection grows a
  second copy of a book it already owns.

  The app knew, and said nothing where anybody was looking. The warning was
  drawn on the capture's own detail and nowhere else, and somebody working
  through a stack never opens that screen: three photographs, "Next book", and
  the next one off the pile. So it is said at the camera, where they are (#435).

  Nothing is blocked and nothing is deleted. Two copies of one book genuinely
  turn up, so this is a finding put in front of a person rather than a refusal,
  and the shutter still answers to nothing but a press.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title | author        |
      | Dune  | Frank Herbert |
    And the camera is pointed at the back cover of "Dune"

  Scenario: The camera says the book is already catalogued
    Given the catalogue service knows about "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then it should say the book is already catalogued

    # Said beside the camera's own answer rather than instead of it. The book
    # is still identified, and the photographs are still accepted.
    And the camera should recognise the book as "Dune"

    # And nothing has been put in front of the shutter, which is the thing #294
    # cost and the thing this must not repeat. Pressed, not inspected: a press
    # is refused if anything at all is floating over the button.
    And the shutter should still take a photograph

  Scenario: It says so even though no source can name the book
    # The case that failed, and the worst one to fail in. The warning used to
    # ride on the lookup result, so the one book nothing could name was the one
    # book nobody was warned about, and it is exactly the book somebody scans
    # twice: there is nothing on the screen to recognise it by.
    #
    # The app knows the ISBN either way. It is read off the barcode and printed
    # on the same screen. Asking the catalogue about it needs no internet at all.
    Given no source can name "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then it should say the book is already catalogued

    # And the camera has nothing else to say about it, which is the point: this
    # book has no title on screen for anybody to recognise it by.
    And the camera should not have recognised the book

  Scenario: It is about the book in hand, and goes when that book is put down
    Given the catalogue service knows about "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then it should say the book is already catalogued

    # A warning carried over on to the next book off the pile is a warning
    # about the wrong book, which is worse than none.
    When I start the next book
    Then it should stop saying the book is already catalogued
