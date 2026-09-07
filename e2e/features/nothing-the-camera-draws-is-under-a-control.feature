Feature: Nothing the camera draws is under a control

  The sibling of "Nothing the camera says is under a control", and the same
  fault twice more. Everything this screen floats on its picture used to find
  the bottom of the screen by counting the controls it expected to be there,
  in a stylesheet that cannot see them: the frame you aim the book inside at
  28% of the screen, the hint about the next photograph at 150px, the two
  answer panels at 260px.

  **These two scenarios are on a 375 by 667 phone and that is the point.** The
  suite runs at 414 by 896, which is the phone this app was drawn at and the one
  every other scenario should be looking at. It is also the size at which both
  of these defects are invisible: the frame's bottom edge is 4px behind the line
  the camera says, and the hint misses "Next book" by 0.4px because 30ch of a
  13px font happens to stop just short of a pill 92px wide. Make the phone
  shorter and the same two numbers put 20px of the frame behind a button and 9px
  of a button under a hint. A bar built out of a 76px shutter and 44px and 36px
  buttons does not get shorter when the screen does, so every one of these is
  worst on the smallest phone anybody holds.

  Nothing that renders a component to markup can see either of them, for the
  reason its sibling gives at length: `<div>` and `<button>` come out of
  `Viewfinder` in the same order whether they overlap or clear each other,
  because markup has no layout.

  The one frame not asked about here is the cataloguing camera's own, which is
  the crop the shutter is really going to keep rather than a drawing of where to
  hold a book. It cannot be moved without changing what gets saved, so it is
  somebody's decision rather than this change's.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Dune"

  Scenario: The frame you aim inside, on a short phone
    # The camera that finds a book you already own draws the design system's
    # frame and says the longest sentence the app puts on a camera. Both at
    # once is the case the frame's bottom edge lost: the line is in the bar,
    # the bar is 48px taller for it, and the frame was measured against the
    # screen and knew nothing about either.
    Given the phone is 375 by 667
    And the camera is pointed at the back cover of "Dune"
    When I open the app
    And I scan the book
    Then the camera should say "9780441013593 is not in the library yet. Add it first."
    And the frame you aim inside should be clear of the bar
    And nothing the camera says should be under a control

  Scenario: The hint about what to photograph, on a short phone
    # It is transient, which is why nobody reported it, and its own comment
    # said pointer events were off so it could not swallow a tap. It still drew
    # a hint over a control, which the stylesheet says twice elsewhere is the
    # thing not to do. The rail is what brings it back, because the hint is
    # said when the slot changes and leaves after a couple of seconds.
    Given the phone is 375 by 667
    And the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I choose the front photograph
    Then the camera should be hinting "The cover. Used for the title if no ISBN turns up."
    And nothing the camera says should be under a control
