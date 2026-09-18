Feature: Nothing the camera says is under a control

  The line telling you what is in your hands can lie underneath "Done with this
  book" every time, not just sometimes: it floats on the picture at an offset
  that clears a shutter, but not the cataloguing camera's near cluster, which is
  three controls tall. The bar is drawn after the line, so the button paints
  over the words.

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
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    Then the camera should say "Nothing in hand. First shot starts a new book."
    And nothing the camera says should be under a control

  Scenario: With a book it has recognised
    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"
    And nothing the camera says should be under a control
