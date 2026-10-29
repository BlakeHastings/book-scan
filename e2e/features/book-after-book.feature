Feature: Book after book, nothing carries over

  Somebody working through a whole collection photographs a book, moves on,
  and photographs the next, hundreds of times in an afternoon, on a phone, over
  a connection that is sometimes slow and a server that is sometimes
  restarting. Each book's photographs belong to that book and to no other, and
  each is written down once.

  Three things broke that on a real afternoon. Saving a book from the camera
  sent its three photographs up a second time, so every book shelved that way
  held each photograph twice. A photograph still on its way when "Next book"
  was pressed came back and claimed the next book, so the next book's
  photographs joined the last one. And a photograph the server never took
  stayed on screen as though it had been kept, under a bare "502 Bad Gateway".

  The requests are held up and refused by the browser here rather than by the
  server, so a scenario can say exactly when the photograph arrives.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the camera is pointed at the back cover of "Dune"

  Scenario: A book shelved from the camera holds each photograph once
    When I open the app
    And I start the camera
    And I photograph all three sides of the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I confirm the details and go to shelve it
    And I watch what the save sends
    And I say it fits
    Then the save should not have sent any photograph again
    And "Dune" should hold one back, one front and one spine photograph

  Scenario: A photograph still on its way does not follow me to the next book
    When I open the app
    And I start the camera
    And the server is slow to take the next photograph
    And I photograph the book
    And I start the next book
    And the photograph arrives at last
    Then the camera should be holding nothing

    When I photograph the book
    Then the queue should hold 2 books with one back photograph each

  Scenario: A server that fails once is not my problem
    When I open the app
    And I start the camera
    And the server answers the next photograph with a bad gateway once
    And I photograph the book
    Then the queue should hold 1 book with one back photograph each
    And the camera should not have shown an error

  Scenario: A photograph the server never took is taken again, once
    When I open the app
    And I start the camera
    And the server answers every photograph with a bad gateway
    And I photograph the book
    Then the camera should say the back cover did not reach the server
    And the camera should be holding nothing

    When the server comes back
    And I photograph the book
    Then the queue should hold 1 book with one back photograph each
    And the camera should not be showing an error
