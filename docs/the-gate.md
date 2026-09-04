# The gate: who is allowed to ask

For #521, the server half of #510. `docs/auth-surface.md` counted every way into
this app and found seventy-two of them, none locked. This is what was done about
that, why each door is on the side of the line it is on, and the count at the
end.

It is an explanation, not a how-to. The commands are in `AGENTS.md`; the
reasoning is here.

---

## What was true the day before this

Quoting the survey rather than paraphrasing it, because the numbers are the
argument:

> **There are seventy-two doors and not one of them is locked.** Seventy-one
> hand-declared route handlers over fifty-five distinct paths, plus one static
> file mount that answers one path per photograph on disk.

and the line it called the single most important one:

```
$ curl -i http://127.0.0.1:62808/api/covers/survey-511-known.jpg
HTTP/1.1 200 OK
Cache-Control: public, max-age=2592000, immutable
Content-Type: image/jpeg
Content-Length: 160
```

An unauthenticated request for a known cover filename, answered with the
photograph, from the LAN as well as from loopback. An unauthenticated
`POST /api/fixtures` answered `201` and created the row.

---

## Where the gate is, and why one line covers everything

The survey's structural finding was that every one of the seventy-two is a route
on one Express app, built by one factory, in one file, with **no middleware at
all between the body parser and the handlers**. So there was exactly one place a
check had to go, and there is now exactly one check there:

```ts
app.use(express.json({ limit: '12mb' }))

mountSignIn(app, signInDeps)   // the five open doors
mountGate(app, signInDeps)     // app.use('/api', gate)

// ... seventy-one handlers, the thumbnail route, the cover mount, the 404 ...
```

**Two properties of that arrangement are doing the work.**

**It is scoped to `/api`, not registered per route.** Every hand-declared handler
and both cover doors live under `/api`. So being behind the gate is a property of
where a path is, not of anybody having remembered: a route added at the bottom of
`server/index.ts` next year is covered because of its path, and a route added
somewhere else would be a route this codebase has never had.

**The open set is the lines above the gate.** Not a predicate, not an allowlist
evaluated per request, not a regular expression somebody has to read carefully.
Five `app.get`/`app.post` calls, then the gate. Everything below it is behind it.

`web/server/gate.routes.test.ts` walks the app's own router stack, finds the gate
by name, and fails if anything but those five is above the line. That is the
count below kept honest by the suite rather than restated by a person.

---

## The three states, and why both refusals are load-bearing

| Who | What the API answers | The body says |
| --- | --- | --- |
| No session, or a dead one | **401** | `state: "anonymous"` |
| A session whose user is not enabled | **403** | `state: "waiting"` |
| A session whose user is enabled | the route | — |

The middle one is the one that gets missed, and #510 says why it cannot be
collapsed into the first:

> A client that cannot tell them apart cannot choose between the login screen and
> the waiting screen.

Getting it wrong makes a person who is signed in and simply not admitted look
logged out, which sends them round the sign-in loop for ever: they sign in
successfully, are told they are not signed in, and sign in again. The words are
in `web/shared/auth.ts` so that both halves of the app read one vocabulary.

**Why there is a middle state at all** is the consequence #510 spells out and it
is worth repeating here. "Sign in with Google" tells you who somebody is. It does
not tell you they may come in, and **every person on earth already holds a valid
Google credential**. So the login is a formality that admits the internet unless
there is a list behind it, and the list is one boolean column on `user`,
defaulting to false.

---

## What is open, and the argument for each of the five

Worked out from the issue's three questions — what serves a login, what a
provider redirects back to, and what tells the client which state it is in —
rather than taken as a list.

| Door | Why it cannot be behind the gate |
| --- | --- |
| `GET /api/auth/providers` | Which buttons a login screen draws. A caller with no session has to be able to ask, or there is no login screen. It discloses which providers this app can be signed into with, which is what the buttons say. |
| `GET /api/auth/session` | Which of the three states the caller is in. This is the one #521 names. It must answer in the `anonymous` state as well as the other two, so it cannot be gated. To a stranger it answers `{"state":"anonymous"}` and nothing else. |
| `GET /api/auth/:provider/start` | The login itself. Nobody has a session before it. |
| `GET /api/auth/:provider/callback` | Where the provider redirects the browser back to. Open by necessity, and the reason a redirect URI has to be an absolute URL registered with the provider ahead of time. |
| `POST /api/auth/signout` | **A judgement rather than a necessity.** Somebody on the waiting-list screen holds a session and is refused `403` everywhere; if signing out were behind the gate they could not sign out, which is the one thing that screen has to offer a person who picked the wrong Google account. It destroys only the session in the caller's own cookie, and a caller with no cookie destroys nothing. |

**And the client's own files**, which are not under `/api` and are therefore open
by construction: `express.static` over `web/dist` and the single-page fallback.
They **are** the login screen, and a person who cannot sign in yet has to be able
to load it. What they disclose is the shape of this app's code, not a row of it,
which is the trade `docs/running-from-a-build.md` decision 3 already weighed for
the source maps beside them.

Those two mounts exist only when a client has been built, so in a development
checkout and in every test the open set is exactly the five.

---

## `GET /api/health` is behind the gate, and this is the trade

The issue asked for this to be decided rather than assumed, because `AGENTS.md`
names it as the one command to run against a running server.

**What it answers**: the collection's counts, the database host, port and name,
the per-catalogue lookup tallies, and the projection disagreement count. The
counts are the collection — how many books somebody owns and how many are out of
the house — and the rest is where the collection lives. A stranger is owed none
of it.

**What is lost, and it is less than it looks**: `curl -i .../api/health` is still
one command and still settles that the server is up and answering, because a
`401` is a running server saying so. What it stops doing is settling *which
database was opened* for somebody who is not signed in. Two readers cared:

- **A person at the machine.** They can sign in — through the development door in
  a checkout, through Google on a deployment — and get the whole body back
  unchanged. `AGENTS.md` says how.
- **The end to end suite**, which asks it to check that the api opened the
  database the AppHost handed it. It now signs in first, through the same
  `GET /api/auth/dev/start` the browser uses, and asks with the cookie.

**Nothing else probes it.** `apphost.mts` declares no health-check path and
Aspire's readiness comes from its own resource model, which the survey verified;
`scripts/smoke-built-server.mjs` never starts a listener. So no automated reader
was broken by this.

`GET /api/backup` goes the same way for a smaller version of the same reason: it
answers whether this collection is backed up, which is a fact about the
collection.

**The `/api` catch-all 404 is behind the gate too**, which is a small bonus on
top of the point: a stranger cannot learn which paths this app answers by asking,
because every one of them says the same thing.

---

## The photographs, which are the door most likely to be left open

They are files served by path, they do not look like data, and the survey
measured an unauthenticated request for a known filename answering `200` with the
photograph.

There are **two** cover doors and a gate that covered one would still hand the
collection over:

- `GET /api/covers/:name?w=160|320|640`, a route that re-encodes a smaller copy;
- `GET|HEAD /api/covers/*`, the `express.static` mount, which answers one path per
  file on disk.

Both are under `/api/covers`, which is under `/api`. The survey had already
established that these two are the whole HTTP-reachable cover surface: of the
fifteen places that touch the cover directory, thirteen reach it from inside the
process or from a CLI, so nothing had to be threaded through the backfills or the
queue.

`gate.routes.test.ts` asks both doors in all three states, and the curl
transcript below asks them too.

---

## The count

Taken from `web/server/gate.routes.test.ts`, which reads the router stack rather
than a list, so this section cannot drift without the suite going red.

| | |
| --- | --- |
| Hand-declared handlers **behind** the gate | **73** |
| Static mounts **behind** the gate | **1** (the photographs) |
| **Total behind the gate** | **74** |
| Handlers registered **above** the gate, and therefore open | **5** |
| Mounts **outside `/api`**, and therefore open | **2**, and only when a client has been built: `express.static` over `web/dist` and the single-page fallback |

The last row is the one to read carefully, because those two are not "in front
of the gate" in the stack — they are registered below it, and they are open
because they are not under `/api`. That is the same fact said the other way
round, and it is why the gate is mounted on a path rather than at the top: the
client's files have to be reachable by somebody who cannot sign in yet.

**Seventy-one of those handlers are `docs/auth-surface.md`'s survey, and two
arrived after it.** #452 added `POST /api/tags` and `DELETE /api/tags`, and they
needed nothing done to them: a route added at the bottom of `server/index.ts` is
covered because of its path, which is the property this arrangement was built
for and the first time since it landed that anything has tested it by being
written. `docs/auth-surface.md` is a survey of one day and is left at its own
count; this table is the live one, and the suite is what keeps it true.

**Every one of `docs/auth-surface.md`'s seventy-two doors is behind the gate.**
The five in front of it did not exist when that survey was taken; they are the
sign-in this issue added, and the survey said in advance that this is the shape
the answer would take:

> Whatever a login screen is served by, and whatever it posts to, will be new
> paths rather than existing ones, because neither exists yet.

**Named in full, the things a stranger can still reach:**

1. `GET /api/auth/providers`
2. `GET /api/auth/session`
3. `GET /api/auth/:provider/start`
4. `GET /api/auth/:provider/callback`
5. `POST /api/auth/signout`
6. `express.static` over the built client, **when a client has been built**
7. the single-page fallback, GET and HEAD, **when a client has been built**

Six and seven are one decision and are the login screen. They are absent in a
development checkout and in every test, where Vite serves the client instead.

**And two things outside this count, said here so nobody reads the count as
covering them.** Both were established by `docs/auth-surface.md` and neither is
changed by this issue:

- **The Vite dev server.** In development, and on the machine that runs the
  owner's catalogue today, the externally reachable process is `vite`, which
  serves the app shell, the client source through `/@fs/`, and an unauthenticated
  HMR websocket. Express is not in that request path at all, so nothing written
  here can gate it. That is the survey's own structural finding — *hosting this
  app and gating it are the same decision* — and it belongs to #471.
- **The Aspire dashboard**, which is development tooling, a different process,
  and not part of any deployment this repository describes.

---

## Who a person is, and what this app owns

Four tables, and the shape follows from one sentence of the owner's: do not store
credentials, do manage the user.

**`user`** — an id this app owns, and `enabled`, defaulting to false. Everything
in the catalogue that ever refers to a person will refer to this id. The id is
ours rather than a provider's because a reading status or a borrower keyed on a
Google subject is lost the day the same human signs in with Apple instead.

**`user_identity`** — the link to an external identity, keyed on **(issuer,
subject)** and deliberately not on email. Email changes, is sometimes unverified,
and two providers can assert the same one about different people. It is carried
on the row so a human reading the enable script's list can recognise who is
knocking, and **nothing in the running app looks anybody up by it**.

**`session`** — ours, in Postgres, addressed by an opaque cookie. What is stored
is the SHA-256 of the cookie value, so a dump of this table is not a set of live
credentials. Thirty days, renewed on use and only when the row has gone an hour
stale, because a phone at a bookshelf that asks for a sign-in every visit gets
abandoned and a gate that writes a row per request costs more than the route
behind it. `HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`, revocable.

**`sign_in_flow`** — one sign-in between the redirect out and the redirect back,
holding the PKCE verifier, the nonce and the state. A row rather than a cookie,
because a row can be **single use**: the callback deletes it, so a replayed
authorization code arrives with nothing left to check it against.

**There is no role, no `is_admin` and no permissions column, not even unused.**
#171 has not decided roles and #510 says an unused column that looks like
authorization is worse than none, because the next person builds against it. The
only question anything here answers is "is this person one of ours", which is the
door rather than a permission on the far side of it.

`enabled` is read from `user` on **every** request rather than cached on the
session. That is what lets the enable script be a script: disabling somebody
takes effect on their very next request, with no session to hunt down.

---

## Signing in: Google, and the seam under it

Authorization code flow with PKCE, server-side. Not implicit; no token reaches
the browser, because a token in a browser is a credential this app cannot revoke,
and what the browser gets instead is a cookie addressing a row it can delete.

**Google first**, because it permits `http://localhost` redirect URIs and could
therefore be built and driven immediately. **Apple is closed**, by the owner's
own decision in #510: there is no developer account, and it was already the
awkward one, refusing `localhost`, needing a domain #471 has not chosen, and
taking a client secret that is an ES256-signed JWT this server would have to mint
and rotate every six months.

**Microsoft is a row now (#537), and the section after next is what it cost.**
This paragraph used to say it deliberately was not one, and the reason it gave
was right: its issuer is tenant-scoped, so a row carrying Google's shape with
Microsoft's endpoints would ship a wrong `iss` check. What it predicted the fix
would be was "one more field on the provider type, an issuer that may be a
pattern". **A pattern is the defect rather than the fix**, and that is the
finding.

**The seam is proved rather than asserted.** `web/server/sign-in.routes.test.ts`
runs a second provider — `acme`, with its own issuer, endpoints and client id,
invented in that file and named nowhere in `server/`, `infrastructure/` or
`shared/` — through the whole flow against a local stub: the authorization URL,
the PKCE verifier proved against the challenge that went out, the token exchange,
the ID token's claims, the user, the session and the gate. A claim that a second
provider is configuration is worth nothing until something has been the second
provider.

**And #537 added a second invented provider beside it**, `wellhouse`, whose
issuer exists only in a discovery document the stub serves. It goes through the
same whole flow, and the case that earns its keep is the one where a token from a
*different tenant on the same authority* is refused. Every other case in that
block is a sign-in that works, which is exactly what the defect would also look
like.

**One shortcut is taken and it is permitted by the specification.** The ID
token's signature is not verified. OpenID Connect Core 1.0 §3.1.3.7 item 6 allows
exactly this for the code flow: when the token comes back through direct
communication with the token endpoint, TLS server validation may stand in for
checking the signature. This server posts to an HTTPS endpoint belonging to the
provider over a connection Node validates, carrying a secret only it holds, and
the token never passes through the browser. What *is* checked is `iss`, `aud`,
`exp`, `nonce` and the presence of `sub` — the claims that make a token *this*
token rather than some other valid one, none of which a signature check would
supply. The thing that would flip it is a flow where the token reaches this
server any other way, and there is none.

**That paragraph used to say "a hard-coded HTTPS endpoint", and #537 changed
what that sentence rests on.** Microsoft's token endpoint is not hard-coded: it
is read from a discovery document. The property the shortcut needs is that the
endpoint belongs to the provider, and what supplies it now is the rule in
`web/server/auth/discovery.ts` that a document may only name endpoints on **its
own origin**. The origin is fixed in this repository, the document is fetched
from it over TLS Node validates, and the endpoints it may nominate cannot leave
it. Take that rule away and the shortcut goes with it, which is why it is a case
in `discovery.test.ts` rather than a sentence here.

---

## Microsoft, whose issuer is not a constant, and the seam that had to move

#523 predicted this would need "one more field on the provider type, an issuer
that may be a pattern". It needed one more field, and **a pattern is the defect
rather than the fix.**

### What was decided, and it is the first job the issue asked for

**One authority per deployment, named in configuration, whose issuer is a
value.** Concretely:

| `BOOKSCAN_OIDC_MICROSOFT_TENANT` | Who can sign in | Supported |
| --- | --- | --- |
| a tenant GUID, or a verified domain | that one organisation | **yes** |
| `consumers` | personal Microsoft accounts | **yes** |
| `common` | every Entra tenant *and* personal accounts | **no** |
| `organizations` | every Entra tenant | **no** |

**There is no default**, and that is the decision rather than an omission. Every
candidate default is wrong: `common` is the defect, `consumers` is this
repository guessing about somebody else's family, and one tenant is site-specific
and may never be written here. So a deployment says, and the process refuses to
start until it does.

The owner's own answer to "which tenants" was *the people in my household*, who
may well be on personal accounts rather than in any tenant at all. `consumers`
is the row that serves that, and it has a real issuer:
`https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`,
the well-known Microsoft-account tenant.

### Why the two multi-tenant authorities are refused, in Microsoft's own words

Read from the live documents on 2026-09-04, at
`https://login.microsoftonline.com/<authority>/v2.0/.well-known/openid-configuration`,
which is a public unauthenticated GET and needs no app registration:

| Authority | `issuer` |
| --- | --- |
| `consumers` | `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` |
| a tenant (discovered by domain) | `https://login.microsoftonline.com/72f988bf-…/v2.0` |
| `common` | `https://login.microsoftonline.com/{tenantid}/v2.0` |
| `organizations` | `https://login.microsoftonline.com/{tenantid}/v2.0` |

**The last two answer with a template, and they are telling the truth.** Those
authorities issue tokens on behalf of every tenant there is, so there is no one
issuer for a token to be checked against. The only way to accept them is a
pattern over `login.microsoftonline.com/<any tenant>/v2.0`, and an Entra tenant
costs nothing and takes ten minutes to create. A check like that answers "which
authority issued this token" with "some authority did", while sign-in keeps
working perfectly. **That is what a wrong issuer check looks like, and it is why
this could not be found by driving a happy path.**

Note the second row as well: discovery performed against a *domain* is answered
with a *GUID*. An issuer spelled from the configured tenant would match no real
token at all.

### They are refused twice, and the order matters

1. `providers.ts` refuses `common` and `organizations` **by name, at start**, so
   the deployment learns in front of whoever is watching the process come up.
2. `discovery.ts` refuses **any templated issuer**, whatever the authority was
   called, when the document comes back.

The second is the guarantee, and it is the one that would still hold if Microsoft
invented a third such authority tomorrow. The first only makes the answer arrive
sooner and in plainer words.

### What is written in this repository, and what is not

**Written down**: one host, `login.microsoftonline.com`, and the shape of the
well-known path. Something has to be the trust anchor, or a document is not worth
fetching.

**Not written down, and read from the authority instead**: the issuer, the
authorization endpoint, and the token endpoint. The row for Microsoft carries
empty strings for all three and a `discovery` URL instead, and `resolveProvider`
fills them in at the first sign-in.

**Never written down**: a tenant id, a client id, a secret or a domain. The three
variables are the deployment's, and the AppHost clears all three so a value in a
shell cannot decide anything about a run started here.

Four rules are applied to a document before any of it is believed, and each is a
case in `web/server/auth/discovery.test.ts`: it is an object with a non-empty
string issuer; the issuer is not a template; the issuer is on the document's own
origin; and both endpoints are too. That last one is what the token endpoint
rests on, because it is where this server posts its client secret.

### Google did not change, which was a requirement rather than a bonus

`providers.ts` argued against discovery: a network call before a sign-in can be
answered, with a cache, an expiry, and a failure mode where the app is up and
nobody can get in. **That argument still stands, and Google still fetches
nothing.** A provider that carries an issuer carries it, resolves to itself, and
touches no network. `discovery.test.ts` asserts the request count is zero for
exactly that reason.

**When it is fetched, and the failure that was chosen.** At the first sign-in
through that provider, not at start. Resolving at start would mean a Microsoft
outage stops this app from booting, and then nobody reaches the catalogue: not
the person signing in, and not the household already holding sessions. Resolving
lazily costs only the people who could not sign in anyway, because signing in
needs Microsoft to be up regardless. Cached for the life of the process, with no
expiry, and successes only, so a bad answer is not remembered.

**An authority that will not say what its issuer is answers `502`, not `400`.** A
token this server refuses is a bad sign-in and is the caller's business; an
authority that cannot be resolved has nothing to do with whoever pressed the
button. There is no branch that carries on without an issuer, because carrying on
without one is the defect.

### What a deployment supplies

Three more variables, and none of their values may ever appear here.

| Variable | Required | Secret | Absent |
| --- | --- | --- | --- |
| `BOOKSCAN_OIDC_MICROSOFT_CLIENT_ID` | with the other two | no | Microsoft is not a way in |
| `BOOKSCAN_OIDC_MICROSOFT_CLIENT_SECRET` | with the other two | **yes** | as above |
| `BOOKSCAN_OIDC_MICROSOFT_TENANT` | with the other two | no | **refuses to start**, naming itself, when the other two are set |

Any one of the three set means all three must be, and the refusal names which are
missing. `BOOKSCAN_PUBLIC_ORIGIN` is required as it already was, because a
redirect URI is an absolute URL, and the URI to register with Microsoft is
`<BOOKSCAN_PUBLIC_ORIGIN>/api/auth/microsoft/callback`. The app registration must
allow the account types the tenant implies: a registration limited to one
organisation cannot serve `consumers`, and the process cannot detect that in
advance.

**The client learns nothing.** `GET /api/auth/providers` grows a row and the
sign-in screen draws one more button, which is what #527 built it for.

### What was proved, and what was not

**Not proved, and it needs a registration this repository must never hold:** an
end-to-end sign-in against Microsoft. Nothing here has spoken to Microsoft except
to read four public discovery documents. Whether the app registration flow, the
consent screen, the real authorization redirect and a real ID token behave as
expected is unproven until somebody with a client id and a secret runs it.

**Proved, without one:** that the discovery document is fetched and read rather
than hardcoded, counted at the far end of a stub rather than assumed; that the
issuer check refuses a token from another tenant on the same authority, driven
end to end and against constructed tokens; that a templated issuer is refused;
that Google fetches nothing; and that the two authorities without one issuer are
refused twice. `docs/process/review.md`'s standard applies here in the shape #533
used: a stub is honest and a claim is not.

---

## How somebody gets let in

`web/scripts/enable-user.ts`, in the shape of `web/scripts/rebuild-projection.ts`.

```bash
cd web
npm run enable-user -- --target '<connection>'                      # lists, writes nothing
npm run enable-user -- --target '<connection>' --enable  <id|email>
npm run enable-user -- --target '<connection>' --disable <id|email>
npm run enable-user -- --target '<connection>' --sign-out <id|email>
```

**A script rather than a route**, and #510 gives the reason: a route that enables
somebody has to be restricted to the owner, which means an administrator, which
is a role. A script has no such problem, because whoever can reach the database
is already the owner. It also solves the bootstrap, which otherwise has no
answer: the first user cannot be enabled by an enabled user, because there is not
one.

Three properties carried over from `rebuild-projection.ts` deliberately:

- **The ordinary use writes nothing.** Listing is the default; enabling is a
  second, separate decision.
- **The target never comes from `ConnectionStrings__bookscan`.** This writes, and
  a connection string that happens to be in a shell must not decide what gets
  written to.
- **It does not refuse port 5433**, because the live catalogue is the one
  catalogue whose owner this command is about. Running it there is the owner's,
  and `scripts/guard-live-data.mjs` refuses an agent that command from inside a
  worktree.

**An email that names two people is refused, with both printed, rather than
resolved.** This is the one place in the codebase where somebody may type an
address, because the person typing it is choosing a row from a list this command
just printed; even here, picking one of two would be this repository deciding the
thing #510 says it must not.

`--disable` and `--sign-out` are separate switches because they are separate
decisions. Disabling takes effect on the next request and leaves the person
holding their session, so they see the waiting-list screen rather than the login
screen, which is the truth of their situation. Signing out takes the credential,
which is what you want after a lost phone.

---

## Development, and the argument that it is not a hole

`aspire start` and several worktrees at once are what make this repository
workable, and a gate that makes a developer sign in through Google to run a
browser test has broken that. #521 asked for the choice to be argued rather than
just made.

**What was chosen: a configuration that seeds an enabled developer identity, not
a configuration that switches the gate off.**

`apphost.mts` sets `BOOKSCAN_DEV_SIGN_IN=developer` on the api resource. That
puts one more entry in the provider registry: a provider whose authorization step
is "configuration named this subject" rather than a round trip to somebody else.
`GET /api/auth/dev/start` then walks the same three steps Google's callback
walks — find or create the user, mint a session row, set the cookie — and
redirects.

**Why that is not a hole, in the order the claims can be checked:**

1. **The gate has no off switch.** There is no option, no variable and no branch
   in the check. It reads a cookie, looks up a session, joins `user`, and answers
   401, 403 or `next()`. Take the development provider away and the sessions it
   made still work; take the session table away and it signs nobody in. That is
   the difference between a provider and a bypass, and
   `sign-in.routes.test.ts` asserts it directly: with the development door
   configured but no cookie presented, the gate still refuses.
2. **The identity it makes is an ordinary row**, filed under the issuer
   `bookscan:dev`, which is not a URL and is not something any real provider could
   assert. The enable script governs it like anybody else.
3. **It is off unless a variable is set**, and `apphost.mts` is the only place in
   this repository that sets it. The AppHost also *clears* the three variables
   that would configure a real provider, for the same reason it already clears
   `BOOKSCAN_DATA` and `BOOKSCAN_BACKUP_DIR`: an inherited value must not decide
   anything about a run started here.
4. **Every start says which of the two states it is in, both ways round**, beside
   the backup line and the built-client line that already do this. "The
   development door is shut" and "the development door is OPEN" are otherwise
   invisible from outside the process and look identical from a browser that is
   already signed in.
5. **It refuses to start beside a real provider.** `signInFrom` throws when
   `BOOKSCAN_DEV_SIGN_IN` is set at the same time as Google is configured. This is
   the one with teeth: the moment somebody configures this app for real, it
   cannot also be carrying the development door, and the process exits naming the
   variable rather than coming up quietly with two ways in.

**The residual risk, said plainly rather than argued away.** A deployment that
sets `BOOKSCAN_DEV_SIGN_IN` and configures no real provider would have an account
anybody who could reach it could sign into. That is one variable, set in one file
in this repository, on a server #520 deliberately left bound to `127.0.0.1`. It
is a smaller surface than the one this issue closed and it is not zero, and the
honest statement is that point 5 covers the configuration somebody would actually
end up in and point 3 covers the rest.

**What a developer does**, once per checkout: open `/api/auth/dev/start` on the
app's own origin. The session lasts thirty days and survives restarts, because
the Postgres volume is per checkout. The api prints the path on every start.

---

## What this deliberately does not do

- **It does not change the loopback bind.** `web/server/index.ts` still listens on
  `127.0.0.1` only. #520 left it that way on purpose and
  `docs/running-from-a-build.md` says why: the bind is the moment this app becomes
  reachable by somebody who is not sitting at the machine, and it belongs to #471
  with this gate in hand rather than to the change that builds the gate.
- **It does not build roles**, an `is_admin`, or a permissions column, not even
  unused.
- **It does not link identities by email**, and `sign-in.routes.test.ts` drives
  the case: two subjects sharing one address become two people.
- **It does not build the screens.** #521 is the server half, and a login screen
  with nothing to post to is a drawing. Until they land, the client will show its
  error banner to a person with no session; the API is what this issue is about
  and it answers `401`, `403` or the route, with the state in the body, which is
  what a screen needs to choose itself.
- **It does not touch `web/vite.config.ts`'s source maps.**
  `docs/running-from-a-build.md` named "this app becoming reachable by anybody who
  is not the owner" as what would flip that decision. This makes the app *less*
  reachable rather than more, and the bind has not moved, so nothing has flipped
  yet. It is #471's to take with this in hand.

---

## What was proved by asking

Driven with `curl` against the app booted by `aspire start` in a worktree on
2026-09-03, with a known photograph planted in that checkout's own cover
directory exactly as `docs/auth-surface.md` planted one. Quoted rather than
summarised.

**A stranger, on the route the survey measured answering `201`:**

```
$ curl -i -X POST $API/api/fixtures -H 'content-type: application/json' \
       -d '{"name":"A bookcase a stranger made","kind":"bookcase"}'
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8

{"state":"anonymous","error":"Sign in to use this."}
```

**A stranger, on the line the survey called the single most important one:**

```
$ curl -i $API/api/covers/gate-521-known.jpg
HTTP/1.1 401 Unauthorized

$ curl -i "$API/api/covers/gate-521-known.jpg?w=160"
HTTP/1.1 401 Unauthorized
```

**A stranger, on everything else:**

```
GET /api/health                -> 401
GET /api/books                 -> 401
GET /api/backup                -> 401
GET /api/carry                 -> 401
GET /api/there-is-no-such-route -> 401
```

**What a stranger *is* told, which is which state they are in and nothing else:**

```
$ curl $API/api/auth/session
{"state":"anonymous"}

$ curl $API/api/auth/providers
{"providers":[{"id":"dev","label":"this machine","start":"/api/auth/dev/start"}]}
```

**Signing in, through the development door this checkout carries:**

```
$ curl -si $API/api/auth/dev/start | grep -i '^set-cookie'
Set-Cookie: bookscan_session=BE60...ZYQ; Max-Age=2592000; Path=/;
  Expires=Sat, 03 Oct 2026 19:14:19 GMT; HttpOnly; Secure; SameSite=Lax
```

**The same four doors, admitted:**

```
POST /api/fixtures             -> 201
GET  /api/covers/$name         -> 200 image/jpeg
GET  /api/health               -> 200
$ curl -H "$C" $API/api/auth/session
{"state":"admitted","user":{"id":"c2819db5-...","enabled":true,
 "email":"developer@localhost","name":"developer"}}
```

**Then the same person is put back on the waiting list, by the script:**

```
$ npm run enable-user -- --target '<connection>' --disable c2819db5-...
Catalogue: postgres localhost:51493/bookscan
c2819db5-... is back on the waiting list. Their next request answers 403, on
whatever session they are holding, with no sign-out needed. Use --sign-out as
well if the credential itself is the problem.
```

**and the SAME cookie, unchanged, on the SAME doors — 403, not 401:**

```
$ curl -i -X POST $API/api/fixtures -H "$C" ...
HTTP/1.1 403 Forbidden
{"state":"waiting","error":"This account is signed in but has not been let in yet."}

GET /api/covers/$name          -> 403
GET /api/covers/$name?w=160    -> 403
GET /api/health                -> 403

$ curl -H "$C" $API/api/auth/session
{"state":"waiting","user":{"id":"c2819db5-...","enabled":false,
 "email":"developer@localhost","name":"developer"}}
```

**and enabled again, on the same cookie, with no second sign-in:**

```
$ npm run enable-user -- --target '<connection>' --enable c2819db5-...
c2819db5-... is in. If they are holding a session already, their next request
goes through; they do not have to sign in again.

POST /api/fixtures             -> 201
GET  /api/covers/$name         -> 200 image/jpeg 31 bytes
```

**And the two requests the survey issued from the LAN, re-issued from the LAN,
through the Vite dev server the phone actually talks to:**

```
$ curl -k -i https://192.168.0.148:64384/api/covers/gate-521-known.jpg
HTTP/1.1 401 Unauthorized

$ curl -k -X POST https://192.168.0.148:64384/api/fixtures -d '{...}'
401

$ curl -k -o /dev/null -w '%{http_code} %{content_type}' https://192.168.0.148:64384/
200 text/html
```

The last one is the point about what stays open: the app shell answers a stranger
because it is the login screen, and everything it would ask the API for does not.

**And the refusal that has teeth, driven rather than described:**

```
$ BOOKSCAN_OIDC_GOOGLE_CLIENT_ID=an-id BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET=a-secret \
  BOOKSCAN_PUBLIC_ORIGIN=https://books.example BOOKSCAN_DEV_SIGN_IN=developer \
  npx tsx server/index.ts

Error: BOOKSCAN_DEV_SIGN_IN is set and so is a real sign-in provider. The
development door signs anybody who reaches it in as an enabled user, which is
safe in a checkout and is a way in anywhere else, so the two are refused
together. Unset BOOKSCAN_DEV_SIGN_IN to use BOOKSCAN_OIDC_GOOGLE_CLIENT_ID, or
unset that to develop.
    at signInFrom (web/server/auth/providers.ts:245:13)
    at <anonymous> (web/server/index.ts:4310:19)
```

The tests are in `web/server/gate.routes.test.ts`,
`web/server/sign-in.routes.test.ts` and `web/scripts/enable-user.test.ts`, and
every `*.routes.test.ts` file in the suite now arrives holding a session, which is
itself evidence: seventy-one handlers are reached through the gate rather than
around it, and the browser suite signs in through the same door before it opens a
page.
