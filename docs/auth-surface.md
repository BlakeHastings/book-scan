# The auth surface: every way into this app, counted

For #511, which is part of #510. This is a survey, not a design. It says what
is true today, and it is deliberately the half that does not depend on how
people sign in, because that question is still open and this count is the same
under every answer to it.

**Nothing here designs a gate.** No schema, no table, no session shape, no
provider. #510 says why: an unused column that looks like authorization is
worse than none, because the next person builds against it.

Every claim below cites a file and a line, or is marked **unestablished**.

## Status

In progress. Sections are filled in as they are established, so a lost session
leaves this document rather than a plan in somebody's head.

## Method

Read at `origin/master`, commit `3690dc5`. Route enumeration is a reading job
against `web/server/index.ts`. The covers behaviour is established by booting
the app and issuing the request, because "what does an unauthenticated request
get" is a fact about behaviour rather than about source.
