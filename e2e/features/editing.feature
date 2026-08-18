Feature: Editing a book, catalogued or fresh off the camera

  A book can be corrected without re-scanning it: open it, edit its details,
  and change the ISBN when the one on record is wrong. Changing the ISBN starts
  a fresh lookup against the catalogue, and that lookup can still be running by
  the time the edit itself is finished.

  Saving used to end the edit regardless of whether a relookup for this same
  book was still in flight. The old ISBN was written, the screen dropped back
  to the record view, and then the relookup's answer landed on it anyway: the
  screen showed a book that was never saved (#63). Save is now unavailable for
  as long as a relookup is running, and reappears the moment it settles, so
  there is nothing left in flight for it to race.

  The same screen shows a book that is already catalogued and one still in the
  queue, and it saves each with its own button. The first of those was fixed
  and the second was not (#88), so both are acted out below: it is the same
  guard or it is not shared, and a scenario for only one branch is what let the
  hole sit open while the suite went green.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Rendezvous with Rama"
    And the catalogue service knows about "The Dispossessed"
    And the catalogue service knows about "Dune"
    And the catalogue already holds:
      | title                | author           |
      | Rendezvous with Rama | Arthur C. Clarke |

  Scenario: Save waits for a slow ISBN relookup instead of racing it
    When I open the app
    And I go to the library
    And I open "Rendezvous with Rama" from the library
    And I start editing the details
    And I arm a slow lookup of "The Dispossessed" taking 3000ms
    And I change the ISBN to that of "The Dispossessed"
    Then "Save changes" should be unavailable while the lookup runs
    And "Save changes" should be available again once the lookup answers
    # A book already in the catalogue, so this is the book page rather than the
    # review screen. Both are converted now (#387) and both call the field what
    # the drawing calls it, so the two scenarios in this file check the one
    # guard on the one form.
    And the review screen should show:
      | Title  | The Dispossessed  |
      | Author | Ursula K. Le Guin |

    When I save the changes
    Then the catalogue should hold "The Dispossessed" recorded as:
      | isbn13 | 9780060512750    |
      | title  | The Dispossessed |

  Scenario: Correcting a note says nothing about where the book physically is
    A save of a catalogued book used to check it back in whatever the edit
    said, so correcting a note on a book that was down off the shelf cleared
    the moment it was taken down. Store.setCheckedOut guards that timestamp
    deliberately, because there is no history table and nothing can recover it
    once it is gone (#87). The screen and the catalogue then disagreed too: the
    record still offered to put back a book the database thought was already
    on the bookcase.

    When I open the app
    And I go to the library
    And I open "Rendezvous with Rama" from the library
    And I check it out
    And I start editing the details
    And I set "Notes" to "in the pile by the door"
    And I save the changes
    Then the catalogue should record "Rendezvous with Rama" as off the bookcase
    And the catalogue should hold "Rendezvous with Rama" recorded as:
      | notes | in the pile by the door |
    And the book should say it is off the bookcase

  Scenario: Shelving a fresh capture waits for the same slow relookup
    Somebody changing an ISBN is most often resolving a book straight off the
    camera, and that is the branch the guard was missing (#88). Shelving before
    the answer arrived took the old book down the shelving step and saved it
    under the previous ISBN with the capture consumed against it: a second Dune
    in the catalogue that nobody had ever looked up.

    Given the camera is pointed at the back cover of "Dune"
    When I open the app
    And I start the camera
    And I photograph the book
    Then the camera should recognise the book as "Dune"

    When I review what it found
    And I arm a slow lookup of "The Dispossessed" taking 3000ms
    And I change the ISBN to that of "The Dispossessed"
    Then "That is the book" should be unavailable while the lookup runs
    And "That is the book" should be available again once the lookup answers
    And the review screen should show:
      | Title  | The Dispossessed  |
      | Author | Ursula K. Le Guin |

    When I confirm the details and go to shelve it
    And I say it fits and save it

    # One book reached the catalogue, and it is the one that was looked up.
    Then the catalogue should be filed in this order:
      | Rendezvous with Rama |
      | The Dispossessed     |
    And the catalogue should hold "The Dispossessed" recorded as:
      | isbn13 | 9780060512750 |
