Feature: Nothing the camera says is under a control

  The line telling you what is in your hands lay underneath "Done with this
  book", and had since it was added. Not sometimes: always, whatever the line
  said, because the line floated on the picture at an offset that cleared a
  shutter while the cataloguing camera's near cluster is three controls tall.
  The bar is drawn after the line, so the button was painted over the words.

  It was invisible for as long as the line was, which was until #530 made it
  readable, and the same screenshot that proved the words could be read showed
  a button lying across them.

  Nothing that renders a component to markup can see this. `<p>` and `<button>`
  come out of `Viewfinder` in the same order and with the same classes whether
  the two boxes overlap by 24px or clear each other by 12, because markup has no
  layout. That is the same reason the tab bar has scenarios of its own, and this
  is the same answer: drive a real page and read boxes.

  The rule is stated as "nothing the camera says", not "this one line", because
  the defect was never about the words. It was about a place worked out by
  counting controls somewhere that cannot see them.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"

  Scenario: With nothing in hand yet
    # The first thing anybody sees on this camera, and the state the old offset
    # was least excusable in: the sentence is the longest of the two and the
    # near cluster is at its tallest, because "Next book" is drawn disabled
    # rather than left out.
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    Then the camera should say "Nothing in hand. First shot starts a new book."
    And nothing the camera says should be under a control

  Scenario: With a book it has recognised
    # The other of the two, and the one somebody reads: this is the line they
    # glance at between two photographs to check they are still on the same
    # book. A title and an author is shorter than the sentence above, and it
    # overlapped by exactly as much, because the offset never depended on what
    # the line said.
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"
    And nothing the camera says should be under a control
