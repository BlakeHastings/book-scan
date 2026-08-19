Feature: The cat on the first screen is alive

  The owner asked for the cat to stop being a picture:

    I'd like the actions that we have available to be scooted down, and then
    the cat laying down sleeping with its tail going behind those buttons, and
    the tail slightly moving, and the cat's eyes sometimes slowly opening a
    little bit and then closing.

  and he asked for it to be checked by looking rather than by reasoning:

    This is something that's very visual, so make sure that we do our end to end
    testing of validation visually, not just programmatically.

  Nothing that renders a component to markup can answer any of this. A tree of
  elements is the same tree whether the stylesheet moves it or not, so "the tail
  moves" stays a claim until something watches frames go by. That is what these
  scenarios are: they take the drawing repeatedly over time and compare it
  against itself, and they measure it against the buttons it is drawn on.

  And the first attempt passed every one of its own tests while being wrong. It
  put the cat in the sixth cell of the counts grid, where he read as a sixth
  count with a long tail, and the owner said so as soon as he saw it:

    This is the cat. It is supposed to be sleeping on the actions, not as part
    of the metrics grid.

  Nothing was checking where he was. Something is now, and it is the last
  scenario here.

  Deliberately not a stored baseline image. This suite has spent real effort
  having nothing left to be flaky about, and a committed screenshot compared
  against a fresh render is the most reliable way to invent a new flake: a font
  hint, a driver, a graphics stack. Everything compared here was drawn by the
  same browser in the same second, so the only thing that can make two frames
  differ is the thing being tested.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |

  Scenario: His tail moves
    # Longer than his slowest cycle, on purpose. He rests for about half of it
    # and then makes one unhurried sweep, because a tail that twitches on a beat
    # reads as a fault rather than as a cat, so a window shorter than the whole
    # cycle could sample the resting half twice and call him dead.
    When I open the app
    Then the cat should be drawn more than one way over 13 seconds

  Scenario: He is still for somebody who asked for less motion
    # A sleeping cat that does not move is still a sleeping cat, so there is
    # nothing to draw instead and nothing to say. He simply stops.
    Given I have asked for less motion
    When I open the app
    Then the cat should be drawn exactly one way over 13 seconds

  Scenario: His tail passes behind the things you can do
    # The half of this that is easy to fake. A tail that stopped in the gap
    # above the buttons, or ran down beside them, would look almost right in a
    # screenshot and would be a cat in a box rather than a cat drawn across the
    # screen. So both halves are asked: the tail reaches well into the button,
    # and the button's own pixels do not change when the cat is taken away.
    When I open the app
    Then his tail should reach into the first thing I can do
    And taking him away should change nothing about it

  Scenario: He is asleep on the things you can do, not among the counts
    # The half that was wrong while everything above it was right, so it is
    # asked in the two ways it can be got wrong: he is clear of the counts
    # altogether, and he is lying along the top edge of the first button rather
    # than hovering somewhere above it with a tail let out to reach.
    When I open the app
    Then he should be lying on the first thing I can do
    And no part of him should be in among the counts
