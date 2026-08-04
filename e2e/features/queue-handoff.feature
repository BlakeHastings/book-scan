Feature: Handing a queued book on to somebody else

  Three people work one pile at once: one photographs, one resolves details,
  one shelves. That only works if the middle person's work is durable, so what
  they work out has to reach the database while the book is still in the queue
  rather than only when it is finally saved.

  It used to not. The routes were create, read, list, claim, release and
  delete, with nothing that updated a queued capture, so a corrected ISBN lived
  in one browser and navigating away lost it (#65). Resolving and shelving had
  to be the same person in one sitting, which collapses three roles into one.

  The handoff below is acted out rather than described: one browser session
  corrects the book, puts it down, and a second session with its own device
  identity picks it up and finds the correction waiting.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"
    And the catalogue service knows about "The Dispossessed"

  Scenario: A correction made in the queue is there for the next person
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I go to the queue
    And I open the queued book
    And I change the ISBN to that of "The Dispossessed"
    Then the review screen should show:
      | Title                     | The Dispossessed  |
      | Authors (comma separated) | Ursula K. Le Guin |

    # Put down without shelving. This is the moment the work used to be lost.
    When I put the book down without shelving it
    Then the queued book should be listed as "The Dispossessed"

    When I come back as somebody else
    And I go to the queue
    And I open the queued book
    Then the review screen should show:
      | Title                     | The Dispossessed  |
      | Authors (comma separated) | Ursula K. Le Guin |
    And the ISBN should read "9780060512750"
    And the ISBN should say it was read from "manual"
    And the queued book should be recorded as:
      | isbn13      | 9780060512750 |
      | isbn_source | manual        |

    # And it is still only ever one book: the correction edited the capture
    # rather than starting a second one.
    And the queue should hold one book
