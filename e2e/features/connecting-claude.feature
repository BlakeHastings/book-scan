Feature: Connecting Claude to the catalogue

  A person can connect an MCP client, such as Claude Code or claude.ai, to this
  catalogue, and the client then reads and changes it as that person. The
  client registers itself, sends the person's browser to this app to sign in
  and approve it, and is sent back a code it exchanges for a token. Nothing
  about it is a second account: the person signs in through the same door the
  app uses, and what the client adds goes through the same save a scan does.

  The client here is the MCP SDK's own, running in the test process and
  listening for the redirect on a loopback port the way Claude Code does. The
  browser is the suite's, and it starts signed out, so the sign-in on the way
  to the consent page is the real one.

  Background:
    Given the catalogue is empty
    And the catalogue service knows about "The Dispossessed"
    And the catalogue already holds:
      | title                | author           |
      | Rendezvous with Rama | Arthur C. Clarke |

  Scenario: A client the person approves can search the catalogue and add a book to it
    Given an MCP client has registered itself and asked to be approved
    When I open the page it sent me to, signed out
    Then I should be asked to sign in to connect the client
    When I sign in through the development door
    Then the consent page should name the client, who I am, and where the answer goes
    When I allow the client
    Then the client should be sent back a code
    When the client exchanges the code for a token
    Then searching through the client for "Rama" should find "Rendezvous with Rama"
    When the client adds the book with the ISBN of "The Dispossessed"
    Then the client should be told "The Dispossessed" was added from the catalogues
    And the catalogue should hold "The Dispossessed" recorded as:
      | isbn13  | 9780060512750     |
      | title   | The Dispossessed  |
      | authors | Ursula K. Le Guin |
      | state   | shelved           |

  Scenario: A client the person denies is sent back with nothing to exchange
    Given an MCP client has registered itself and asked to be approved
    When I open the page it sent me to, signed out
    And I sign in through the development door
    And I deny the client
    Then the client should be told access was denied
    And the catalogue should hold no book called "The Dispossessed"
