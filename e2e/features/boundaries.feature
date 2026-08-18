Feature: Adjusting where one area ends

  A plank stops where somebody ran out of room, not where the books say it
  should, so where an area ends is the one arbitrary thing in this model and it
  has to be adjustable by hand.

  Only the first and last book of an area can be moved, and only to the plank
  beside it. That is not a limited version of drag and drop: it is the complete
  set of moves that leave every other book where it was, because the last book
  of an area becomes the first of the next one without gaining or losing a
  single neighbour.

  The move lives on the book's own page, offered only when that book is
  genuinely at an edge (#96). The library draws the shelves; it does not offer
  a control that can move the wrong book with one misplaced tap in a scrolling
  run of spines.

  The assertions go to the database and to the "needs attention" list, because
  the way to get this wrong is to move the boundary and not record where the
  book went, which turns a move somebody just made into a move the app tells
  them to make.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |
      | The Dispossessed     | Ursula K. Le Guin |
    And "1A" filled up, so its last book started a new area

  Scenario: A book is bounced across the boundary, and bounced back
    When I open the app
    And I go to the library
    Then the library should show "Dune" on shelf "1A"
    And the library should offer no boundary moves

    # A book in the middle of a plank cannot move at all without being filed
    # out of order, and its own page does not pretend otherwise.
    When I open "Rendezvous with Rama" from the library
    Then the book should not offer to move it

    # Offered on exactly the two books at the edges, and in one direction
    # each: nothing before 1A, nothing after 1B.
    When I go to the library
    And I open "Dune" from the library
    Then the book should offer to move it:
      | Move it on to 1B |

    # A move is a placement, so it goes through the shelving step: the app
    # names the plank and waits to be told the book is on it.
    When I choose to move it on to "1B"
    Then it should tell me to put "Dune" in the gap at "1B"

    When I say it fits and finish the move
    Then the library should show "Dune" on shelf "1B"
    And the catalogue should hold "Dune" recorded as:
      | location | 1B |

    # The point of the restriction: nobody else was asked to move.
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |

    # It moved for a real reason and the record matches the room, so there is
    # nothing to report.
    And nothing should need attention

    When I open "Dune" from the library
    Then the book should offer to move it:
      | Move it back to 1A |

    # No wait on the instruction sentence in between, on purpose. Somebody who
    # already knows where the book is going taps straight through, and the
    # move has just changed the shelves the app is about to describe. #105 was
    # that tap being answered against the plank the book had come from: the
    # screen still said 1B, so 1B is what got written down.
    When I choose to move it back to "1A"
    And I say it fits and finish the move
    Then the library should show "Dune" on shelf "1A"
    And the catalogue should hold "Dune" recorded as:
      | location | 1A |

    # The round trip closed. Everything is back where the Background put it,
    # which is the whole claim: a move and its reverse leave no trace, in the
    # drawing and in the database both.
    And the library should show "The Dispossessed" on shelf "1B"
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |
    And nothing should need attention

  Scenario: A move nobody acted on is taken back, without claiming a walk
    # The move is offered on a phone, one mistap from a book somebody was only
    # looking at. Until #196 the only way out of it was to tap "Moved it",
    # asserting a walk that never happened, and then move the book again: two
    # false statements about the room to undo one tap.
    When I open the app
    And I go to the library
    And I open "The Dispossessed" from the library
    Then the book should offer to move it:
      | Move it back to 1A |

    When I choose to move it back to "1A"
    And I go back to the book details

    # The furniture moved and nobody carried anything, which is the truth and
    # is what the list is for. The boundary is not offered again from here: the
    # book is not where the catalogue says it is, so it is not at an edge of
    # anything the catalogue can reason about.
    Then the book should not offer to move it

    When I go to the library
    Then the list should offer to undo the move for "The Dispossessed"

    When I undo the move for "The Dispossessed"
    Then nothing should need attention

    # Back on the plank it never left. The area came back with it: sending the
    # only book of the last area away leaves its boundary describing a place no
    # book is on, so the move took the boundary out and the undo made it again.
    And the library should show "The Dispossessed" on shelf "1B"
    And the library should show "Dune" on shelf "1A"

    # And no location was written by any of it, which is the whole point.
    And the catalogue should hold "The Dispossessed" recorded as:
      | location | 1B |
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | location | 1A |

  Scenario: The notice on a book is the door to the step that places it
    # The book's own page used to answer for the walk. A card at the top named
    # both planks and offered "Moved it", which wrote a location from wherever
    # the person happened to be standing, and the page then had to re-read both
    # the card and the drawing under it or leave the picture contradicting the
    # tap (#197).
    #
    # Round ten made the notice a door (#409). It says one sentence, it names
    # no plank, and pressing it opens the step a newly scanned book and a
    # carried book are both placed on. So the location is written by somebody
    # saying the book fits, and this walks that from the shelves to the row.
    When I open the app
    And I go to the library
    And I open "Dune" from the library
    Then the book should offer to move it:
      | Move it on to 1B |

    When I choose to move it on to "1B"
    And I go back to the book details
    Then the book should say it is supposed to be moved
    And the book should not offer to move it

    # What the notice stopped saying, said by the screen it opens: the plank is
    # named where somebody is about to stand in front of it.
    When I press the notice about moving it
    Then the shelf drawing should be labelled "1B"

    When I say it fits and finish the move
    Then nothing should need attention
    And the library should show "Dune" on shelf "1B"
    And the catalogue should hold "Dune" recorded as:
      | location | 1B |
