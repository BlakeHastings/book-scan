@front-camera
Feature: A cover with no ISBN on it is not an error

  Most photographs of a book carry no ISBN: a front cover never does, and a
  back cover often has none either, or a barcode the phone could not make out.
  The queue reads each one and says so, and that is an ordinary answer, not a
  failure: the book is finished at review, where its details are typed in.

  The camera used to put that answer over the viewfinder in the red it uses
  for a photograph that was lost, while the next photograph was being lined
  up, and put it back every second and a half after it was tapped away. So
  it says it quietly now, and what the queue wrote goes to review with the
  book, where it is evidence for whoever fills the details in.

  The camera here is pointed at a front cover, which carries no barcode.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the camera is pointed at the front cover of "Dune"

  Scenario: The camera says quietly that it read no ISBN, and review says what it did read
    When I open the app
    And I start the camera
    And I photograph the front of the book
    Then the camera should say it has read no ISBN yet
    And the camera should not be showing an error

    When I finish with the book without an ISBN
    Then review should carry what the queue said about the photographs
