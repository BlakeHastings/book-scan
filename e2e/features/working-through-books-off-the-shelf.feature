Feature: Books on no shelf are in the queue to work through

  After every book has been taken off its shelf, the queue lists them as a
  second job beside the captures, in shelf order. Tapping one goes straight to
  the step that says where it goes, and once it has a plank it leaves the list.
  The books stay catalogued throughout: nothing sends them back to be
  identified.

  Background:
    Given the catalogue is empty
    And the catalogue already holds:
      | title                | author            |
      | The Dispossessed     | Ursula K. Le Guin |
      | Rendezvous with Rama | Arthur C. Clarke  |
      | Dune                 | Frank Herbert     |

  Scenario: The books taken off their shelves are listed, and placing one takes it off the list
    When I open the app
    And I open the settings
    And I ask to "Take every book off its shelf"
    And I type "unplace every book" and "Take every book off its shelf"
    And I go to the queue
    Then the queue should say "3 not on a shelf yet"
    And the books not on a shelf should be, in order:
      | title                |
      | Rendezvous with Rama |
      | Dune                 |
      | The Dispossessed     |

    When I place "Dune" from the queue
    Then the books not on a shelf should be, in order:
      | title                |
      | Rendezvous with Rama |
      | The Dispossessed     |
    And the queue should say "2 not on a shelf yet"
    And "Dune" should stand on a plank, put there by a person
    And every book should still be catalogued

  Scenario: A book no rule claims is listed too, and can be put on a shelf by hand
    Given the catalogue also holds "Roadside Picnic", which nothing says is fiction or not
    When I open the app
    And I go to the queue
    Then the books not on a shelf should be, in order:
      | title           |
      | Roadside Picnic |

    When I put "Roadside Picnic" on the first shelf offered
    Then "Roadside Picnic" should stand on a plank, put there by a person
    And the queue should say "Even the cat"

  Scenario: A book a rule wants somewhere particular is offered that place
    Given a rule wants books tagged "subject/deserts" on "4A"
    And "Dune" is tagged "subject/deserts"
    When I open the app
    And I open the settings
    And I ask to "Take every book off its shelf"
    And I type "unplace every book" and "Take every book off its shelf"
    And I go to the queue
    And I put "Dune" where the rules want it, on "4A"
    Then "Dune" should stand on "4A"
    And "Dune" should stand on a plank, put there by a person
    And the books not on a shelf should be, in order:
      | title                |
      | Rendezvous with Rama |
      | The Dispossessed     |
