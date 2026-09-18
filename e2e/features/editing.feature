Feature: Editing a book, catalogued or fresh off the camera

  A book can be corrected without re-scanning it: open it, edit its details,
  and change the ISBN when the one on record is wrong. Changing the ISBN starts
  a fresh lookup against the catalogue, and that lookup can still be running by
  the time the edit itself is finished.

  Save is unavailable for as long as a relookup is running, and reappears the
  moment it settles, so there is nothing left in flight for it to race.

  The same screen shows a book that is already catalogued and one still in the
  queue, and it saves each with its own button. Both are acted out below, to
  check that the same guard covers both.

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
    And the review screen should show:
      | Title  | The Dispossessed  |
      | Author | Ursula K. Le Guin |

    When I save the changes
    Then the catalogue should hold "The Dispossessed" recorded as:
      | isbn13 | 9780060512750    |
      | title  | The Dispossessed |

  Scenario: Correcting a note says nothing about where the book physically is
    `Store.setCheckedOut` deliberately guards the checked-out timestamp on a
    save, because there is no history table and nothing can recover it once it
    is gone.

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

  Scenario: The page stops explaining the delete, and the dialog does the explaining
    Removing an inline lecture is not the same as removing a warning: it belongs
    at the moment of the irreversible act, not permanently on the screen. So
    this walks the safety rather than trusting it, and ends by backing out,
    because a scenario that proves the dialog by deleting the book proves
    nothing about the dialog.

    When I open the app
    And I go to the library
    And I open "Rendezvous with Rama" from the library
    Then the page should say nothing about what deleting does

    When I ask to delete the book
    Then the dialog should say what is lost and that nothing can put it back

    When I keep the book
    Then the catalogue should hold "Rendezvous with Rama" recorded as:
      | title | Rendezvous with Rama |

  Scenario: Shelving a fresh capture waits for the same slow relookup
    Somebody changing an ISBN is most often resolving a book straight off the
    camera. Shelving before the answer arrives would take the old book down the
    shelving step and save it under the previous ISBN with the capture consumed
    against it: a second Dune in the catalogue that nobody had ever looked up.

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

    Then the catalogue should be filed in this order:
      | Rendezvous with Rama |
      | The Dispossessed     |
    And the catalogue should hold "The Dispossessed" recorded as:
      | isbn13 | 9780060512750 |
