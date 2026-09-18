Feature: Photographing a book that is already on a shelf

  The catalogue already holds this book. Somebody has picked it up off a pile
  and is photographing it a second time, which is how a collection grows a
  second copy of a book it already owns.

  Somebody working through a stack never opens the capture's own detail screen:
  three photographs, "Next book", and the next one off the pile. So it is said
  at the camera, where they are.

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

    And the camera should recognise the book as "Dune"

    And the shutter should still take a photograph

  Scenario: It says so even though no source can name the book
    Given no source can name "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then it should say the book is already catalogued

    And the camera should not have recognised the book

  Scenario: It is about the book in hand, and goes when that book is put down
    Given the catalogue service knows about "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then it should say the book is already catalogued

    When I start the next book
    Then it should stop saying the book is already catalogued
