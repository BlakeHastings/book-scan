Feature: Editing a catalogued book

  A catalogued book can be corrected without re-scanning it: open it from the
  library, edit its details, and change the ISBN when the one on record is
  wrong. Changing the ISBN starts a fresh lookup against the catalogue, and
  that lookup can still be running by the time the edit itself is finished.

  Saving used to end the edit regardless of whether a relookup for this same
  book was still in flight. The old ISBN was written, the screen dropped back
  to the record view, and then the relookup's answer landed on it anyway: the
  screen showed a book that was never saved (#63). Save is now unavailable for
  as long as a relookup is running, and reappears the moment it settles, so
  there is nothing left in flight for it to race.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "Rendezvous with Rama"
    And the catalogue service knows about "The Dispossessed"
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
    Then Save changes should be unavailable while the lookup runs
    And Save changes should be available again once the lookup answers
    And the review screen should show:
      | Title                     | The Dispossessed  |
      | Authors (comma separated) | Ursula K. Le Guin |

    When I save the changes
    Then the catalogue should hold "The Dispossessed" recorded as:
      | isbn13 | 9780060512750    |
      | title  | The Dispossessed |
