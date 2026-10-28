# The MCP connector: how a Claude signs in as a person

For #613, the first child of #612. A person who is signed in and let in can add
this app as a custom connector in claude.ai (or `claude mcp add --transport http`
in Claude Code), approve it in the browser, and the client then holds a token
that calls tools **as that person**. `whoami` proves the chain; the read tools
(#617) search and read the catalogue, and the write tools (#618) add,
edit and tag books.

This page is the explanation and the research behind it. `docs/the-gate.md` has
the doors and the count; the code is `web/server/mcp/` and
`web/infrastructure/auth/oauth-store.ts`.

**To connect Claude, follow [`connecting-claude.md`](connecting-claude.md)**:
the steps for claude.ai, the Claude apps and Claude Code, the consent screen,
disconnecting, and what to check when it fails.

---

## What it was built against

**The MCP specification, revision 2025-11-25**, its authorization section:
<https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>.
**`@modelcontextprotocol/sdk` 1.32.2**, the current stable release on npm on
2026-10-28. **Claude's connector authentication requirements**:
<https://claude.com/docs/connectors/building/authentication>.

What the specification asks of a server, in the parts that decided something
here:

- the MCP server **MUST** publish protected resource metadata (RFC 9728) and
  point to it from a `401`'s `WWW-Authenticate: Bearer resource_metadata=...`,
  or at a well-known path;
- the authorization server **MUST** implement OAuth 2.1 with PKCE `S256` and
  publish RFC 8414 metadata including `code_challenge_methods_supported`;
- clients **MUST** send `resource` (RFC 8707) on both the authorization and the
  token request, and the server **MUST** only accept tokens issued for itself;
- **SHOULD** support Client ID Metadata Documents, **MAY** support Dynamic Client
  Registration (RFC 7591), which the revision keeps "for backwards
  compatibility";
- refresh tokens for public clients **MUST** be rotated;
- redirect URIs **MUST** be matched exactly, and the consent screen **MUST**
  show the redirect URI's host, with a warning when it is loopback only.

What Claude's documentation adds, and each line drove a choice below:

- **A `401` is what starts sign-in**, and Claude uses only the first entry of
  `authorization_servers`.
- **The PRM `resource` must equal the URL the person typed**, path included.
- **Claude chooses CIMD only if the server advertises both
  `client_id_metadata_document_supported: true` and `none` in
  `token_endpoint_auth_methods_supported`; otherwise it registers through DCR.**
  DCR and CIMD both make Claude a **public client**.
- **The callback for claude.ai, Desktop, mobile and Cowork is exactly
  `https://claude.ai/api/mcp/auth_callback`.** Claude Code uses a loopback
  redirect on an ephemeral port, `http://localhost:<port>/callback` or
  `http://127.0.0.1:<port>/callback`, and needs the port ignored when matching.
- **`/token` must accept `application/x-www-form-urlencoded`** and `/register`
  JSON. Refresh failures must answer `invalid_grant`. Rotate, and return the new
  refresh token in the response that invalidates the old one.
- **Ten seconds** for discovery, registration and token; thirty for refresh.

---

## The choices, and why

### The SDK's handlers, not `mcpAuthRouter`, and no second framework

`mcpAuthRouter` mounts `/authorize`, `/token`, `/register`, `/revoke` and the
two metadata documents as one router at the root. This mounts **the same SDK
handlers** (`authorizationHandler`, `tokenHandler`, `clientRegistrationHandler`,
`revocationHandler`, `metadataHandler`, `requireBearerAuth`) one by one, in
`web/server/mcp/mount.ts`, for two reasons:

1. **Each door is its own path in the router stack.** `gate.routes.test.ts`
   fails on any path outside `/api` that is not a listed door, and a single
   router at `/` would be one layer answering every path.
2. **The metadata can say what this server does.** `createOAuthMetadata`
   advertises `client_secret_post`, and every client here is public, so the
   metadata is the SDK's with `token_endpoint_auth_methods_supported` replaced by
   `["none"]`.

Nothing else was brought in. The SDK depends on Express 5 and nests its own
copy; the app stays on Express 4 and mounts the SDK's routers as ordinary
middleware, which is what they are. That was driven end to end in the suite and
against the booted app, below.

Not used: the SDK's `ProxyOAuthServerProvider`, which delegates to another
authorization server. #612 decided this app is its own authorization server,
because the human step is a sign-in it already has.

### The human step is the existing sign-in

`/authorize` reads the session cookie the gate reads (`ConnectorProvider.authorize`
in `web/server/mcp/provider.ts`), and draws one of three pages:

| Who | Page |
| --- | --- |
| No session | **Sign in to connect.** One link per configured provider, to the existing `/api/auth/<provider>/start?next=/authorize?...`, rebuilt from the validated request, so signing in lands back on the same authorization request. |
| A session whose user is not enabled | **403, not let in yet**, the gate's `waiting`. No code. |
| An enabled user | **The consent page**: the client's name, who you are signed in as, the redirect URI's host, a loopback warning when it is one, Allow and Deny. |

**The consent page is a CSRF target, and the answer is behind the gate.** The
page carries 32 random bytes; `oauth_consent` holds their SHA-256, the session
the page was drawn for, and the whole authorization request. Allow and Deny post
to `POST /api/mcp/consent`, which is under `/api` and so behind the gate, and
which takes the row once and only from the same session. Posting from another
session spends the token and answers "expired". Nothing the browser posts back
can change which client, redirect or challenge is approved, because none of it
is in the form.

The page is unframeable (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), so
the approve button cannot be clickjacked. Its `form-action` names this origin
and the redirect URI's origin, because browsers apply `form-action` to the
redirect a submission is answered with.

### Clients are public, registered by DCR or named by a document

claude.ai registers through DCR when the server does not advertise CIMD, and
both make it a public client. So **every client is registered public**, whatever
it asks for: RFC 7591 lets the server replace requested metadata, and the
response says `token_endpoint_auth_method: "none"`. There is then no client
secret to store, which matters because the SDK compares a secret as plain text
and so could only check one this server kept in the clear.

**Redirect URIs must be `https`, or `http` to `localhost`, `127.0.0.1` or
`[::1]`, with no fragment.** Matching is the SDK's: exact, except that a loopback
port is ignored, as RFC 8252 section 7.3 requires and Claude Code needs.

**CIMD is supported since #640**, beside DCR rather than instead of it. The
next section is the whole of it.

### Clients that name themselves with a metadata document (#640)

#### What was read

- **The MCP specification, 2025-11-25**, "Client ID Metadata Documents". It
  cites **draft-ietf-oauth-client-id-metadata-document-00**. Authorization
  servers **SHOULD** support CIMD; a server that does **MUST** check that the
  fetched document's `client_id` equals its URL exactly, **MUST** check the
  authorization request's redirect URI against the document's `redirect_uris`,
  **MUST** check the document is valid JSON with the required fields, and
  **SHOULD** cache it respecting HTTP cache headers. Support is advertised as
  `client_id_metadata_document_supported: true` in RFC 8414 metadata. Its
  security section repeats the SSRF warning ("a malicious client could use this
  to trigger the authorization server to make requests to arbitrary URLs") and
  says the server **MUST** clearly display the redirect URI's host and
  **SHOULD** warn on a loopback-only redirect, because CIMD by itself cannot
  stop somebody quoting a real client's URL and listening on a loopback port.
- **The draft itself.** `-00` is what the specification cites; the current
  revision is **`-02`, 6 July 2026**, and where they differ this follows the
  stricter. The `client_id` URL **MUST** be `https`, have a path, and carry no
  fragment, no user name or password and no dot segments. The document **MUST
  NOT** carry `client_secret` or a shared-secret `token_endpoint_auth_method`.
  `-02` adds that the server **MUST NOT** follow redirects, that anything but
  `200` is an error, and that it **MUST NOT** fetch from an address RFC 6890
  calls special-use. Errors and invalid documents **MUST NOT** be cached, and
  the server **MAY** bound the cache lifetime both ways. It recommends a
  **5 kilobyte** ceiling, and says to show the `client_id`'s host on the
  consent screen.
- **Claude's documentation** (`connectors/building/authentication`,
  `connectors/building/lazy-authentication` and `connectors/custom/add-unlisted`,
  read 2026-10-28). Claude uses CIMD only when the metadata says both
  `client_id_metadata_document_supported: true` and `"none"` in
  `token_endpoint_auth_methods_supported`; otherwise it falls back to DCR. The
  custom-connector dialog's **Use Claude's published identity** is this: "The
  server reads Claude's client details from a Client ID Metadata Document that
  Anthropic hosts." The lazy-authentication page tells a server to name the
  `client_id`'s host on the consent screen "not the document's `client_name`,
  because the document is self-asserted".

#### What Claude actually sends

**Claude Code's document is published, and was fetched** on 2026-10-28
(`Cache-Control: public, max-age=300`, 317 bytes):

```
GET https://claude.ai/oauth/claude-code-client-metadata
{"client_id":"https://claude.ai/oauth/claude-code-client-metadata","client_name":"Claude Code",
 "client_uri":"https://claude.ai","redirect_uris":["http://localhost/callback","http://127.0.0.1/callback"],
 "grant_types":["authorization_code","refresh_token"],"response_types":["code"],
 "token_endpoint_auth_method":"none"}
```

Its redirect URIs carry no port, and the SDK's loopback match ignores the port,
so `http://localhost:<any>/callback` matches.

**claude.ai's own document URL is not published anywhere I could find.** The
documentation says Anthropic hosts it, and that the hosted apps redirect to
exactly `https://claude.ai/api/mcp/auth_callback`; ten likely paths under
`claude.ai/oauth/` answered Cloudflare's `403`. So this was built to the
specification rather than to a known document, on the reading that claude.ai's
`client_id` is an `https` URL on `claude.ai` whose document lists that one
callback and says `"none"`. Nothing here names claude.ai specially: any
document that passes the checks below is accepted, and the person approving it
sees where it came from.

#### Does the SDK do this

**Not on the server side.** `@modelcontextprotocol/sdk` 1.32.2, still the latest
on npm on 2026-10-28, has CIMD on the **client** side only:
`OAuthClientProvider.clientMetadataUrl`, used when the server advertises support
(`client/auth.js`, "SEP-991: URL-based Client IDs"). On the server side the only
trace is the `client_id_metadata_document_supported` field in the metadata
schema; `authorizationHandler` and `authenticateClient` both just call
`clientsStore.getClient(client_id)`. So the document is fetched inside our own
`getClient` (`ConnectorProvider` in `web/server/mcp/provider.ts`), and nothing
else was brought in. The SDK's own client is what drives the tests.

#### How it works here

`getClient` looks at the shape of the id. **A registered client's id is a
`randomUUID()`; a document client's id starts `https://`**, and neither can be
the other, so the two never collide. `registerClient` refuses to store an
`https` id in case the SDK ever stops generating UUIDs, and a body that sends
`client_id` to `/register` is given a UUID anyway (the SDK strips it); both are
tested.

A document client is fetched, checked and stored **only by the provider that
answers `/authorize`**. `/token` and `/revoke` are answered by a second provider
that never fetches: it reads the row the approval was made against, however
old. So nothing posted to `/token` makes this server send a request, and a
connection keeps refreshing while the document's publisher is down.

**And `/authorize` does not fetch for a stranger.** A middleware in front of the
SDK's handler (`holdDocumentClients`) looks at `client_id` first. For a document
id with no session it draws the sign-in page, naming the client by its host
("Sign in to connect the client at claude.ai"); for a session that is not let in
it draws the waiting page. Only an **enabled** person's request reaches the
fetch. So the people who can make this server send a request to a URL of their
choosing are the people the owner has let in, not the internet. The
specification's own sequence diagram has the person authenticate before the
fetch too.

The document must then say:

| Field | Required |
| --- | --- |
| `client_id` | Exactly the URL it was fetched from |
| `redirect_uris` | At least one, each `https` or `http` to loopback with no fragment, the same rule as DCR. These **are** the registered list: the SDK matches the request's redirect URI against them |
| `token_endpoint_auth_method` | Exactly `"none"`. Absent is refused, because RFC 7591's default is a secret method |
| `client_secret`, `client_secret_expires_at` | Absent |
| `grant_types`, `response_types` | If present, include `authorization_code` and `code` |
| `client_name` | Text, if present. Shown, never trusted |

The id itself must be `https`, have a path, have no fragment or credentials, and
be in normal form (`new URL(id).href === id`), which refuses dot segments, an
upper-case host and a spelled-out `:443`: the document's `client_id` is compared
with this string exactly, so two spellings would be two clients.

**The consent page shows both the name and the host**: "Allow Claude Code to
use this catalogue as you?" and, under it, "This client describes itself in a
document at claude.ai. The name above is what that document says; the address
is who published it." The redirect host and the loopback warning are shown as
before.

#### The fetch, and the SSRF controls

`web/server/mcp/client-document.ts`. `server/bounded-fetch.ts` was read and not
used: it has a timeout and nothing else, uses the global `fetch` (which resolves
names itself and follows redirects), and has no size limit.

1. **`https` only.** Anything else is refused before resolution.
2. **Every address is checked before a socket opens.** The name is resolved once
   (`dns.lookup`, all addresses), and **if any one** is special-use the fetch is
   refused: a name answering one public and one private address is a name
   somebody pointed at both. An address written into the URL
   (`https://10.0.0.1/...`, `https://[::1]/...`) is checked the same way.
   Refused: every RFC 6890 IPv4 range (`0/8`, `10/8`, `100.64/10` carrier-grade
   NAT, `127/8`, `169.254/16` link-local and cloud metadata, `172.16/12`,
   `192.168/16`, the documentation and benchmarking ranges, multicast, `240/4`),
   and for IPv6 anything outside global unicast `2000::/3` (which takes
   loopback, link-local, unique-local, multicast, NAT64 and IPv4-mapped) plus
   `2001::/23`, `2001:db8::/32` and `2002::/16`, which embed IPv4 or are
   documentation.
3. **The socket is pinned to the address that was checked.** The request is
   made with Node's `https.request` and a `lookup` that answers the checked
   address, so there is no second resolution for a DNS rebinding to win.
4. **No redirect is followed.** Anything but `200` is a refusal, and a `3xx`
   says so. So there is no "check again after the redirect" to get wrong.
5. **Five seconds and five kilobytes** (the draft's figure, 5120 bytes). A
   declared `Content-Length` over it is refused without reading; a body that
   grows past it is cut off mid-stream.
6. **No cookie, no credential, no compression.** The request carries `Accept`
   and `User-Agent` and nothing else (a test asserts the exact header set), on a
   fresh agent with no connection reuse. No `Accept-Encoding` is sent and a
   compressed answer is refused, so there is no decompression to bomb.
7. **JSON only**: `application/json` or `application/*+json`.
8. **TLS is verified** against the system's roots; only a test passes a
   certificate of its own.

The address rule and the resolver are the two seams a test replaces
(`clientDocuments` on `createApp`), so a test can serve a document from
loopback. Nothing in the running server sets them.

#### The cache: in `oauth_client`, no migration

A document client needs an `oauth_client` row anyway, because `oauth_consent`
and `oauth_grant` reference it. So the cache **is** that row: `client_id` is the
document's URL, `metadata` is what was kept of the document plus
`document_fresh_until`, and `created_at` is when it was last fetched. The
existing columns fit, so there is no migration and no in-memory cache.

- **Lifetime**: the document's `Cache-Control: max-age`, at most **one hour**,
  five minutes when it says nothing, and **zero** for `no-store` or `no-cache`
  (fetched again at every `/authorize`, though still stored, because grants need
  the row).
- A refetch **updates the row in place** (an upsert on `client_id`) rather than
  replacing it, because a delete would cascade the person's grants away.
- **A refusal is not stored**: a document that fails leaves the previous row
  exactly as it was, and the next `/authorize` fetches again.
- `/token` and `/revoke` read the row whatever its age (above).
- `web/server/mcp/sweep.ts` treats these rows like registrations: one with no
  grant and no open consent page goes a day after it was last fetched.

#### What was proved

`web/server/mcp/client-document.test.ts` (no database) runs the fetcher against
a real `https` server on loopback that counts every TCP connection: a valid
document is read with exactly `accept`, `connection`, `host` and `user-agent`
sent; a name resolving to `127.0.0.1`, `10.0.0.5`, `192.168.1.1`,
`169.254.169.254`, `100.64.0.1` or `::1` is refused **with the connection count
still nought**, as is a name with one public and one private address and an
address written into the URL; the name is resolved once and the connection goes
to it; a `302` is not followed (the second path is never requested); a declared
oversize body, an undeclared one streaming up to ten megabytes, a body that never
finishes, HTML, broken JSON, an untrusted certificate and plain `http` are each
refused. Beside those: the address table, the id shapes, the lifetime arithmetic
and the document checks.

`web/server/mcp/client-document.routes.test.ts`, against Postgres and the SDK's
own client with `clientMetadataUrl` set: the metadata advertises both values;
the client connects **without registering**, the consent page shows "Claude
Code" and the document's host, the code is exchanged, `whoami` answers the
person, a refresh works, the connection is listed under the document's name, and
the document was fetched **once** for all of it. A stranger and a person not let
in get their pages **with no connection made**; a mismatched `client_id`, a
document on a private address (no connection made), an oversize and a slow
document are each `400 invalid_client` and leave no row; a redirect URI outside
the document is `Unregistered redirect_uri`; the cache is reused inside
`max-age` and fetched again after it; and when the publisher starts answering
`500` a new approval is refused while the existing connection still refreshes
and calls a tool with no further request. DCR still connects beside it,
`/register` cannot be talked into an `https` id, and an unknown UUID fetches
nothing.

Reverting each control and quoting the failure:

- the address check off: *"refuses a document on a private address before any
  request is sent → expected 200 to be 400"*, and in the fetch tests *"expected
  1 to be +0"*;
- the `client_id` match off: *"refuses a document whose client_id is not its own
  URL → expected 200 to be 400"*;
- the hold in front of `/authorize` off: *"sends a stranger to sign in without
  fetching anything → expected 1 to be +0"*;
- the `/token` provider allowed to fetch: the refresh after the publisher fails
  throws *"InvalidClientError: This client's metadata document was refused: The
  document answered 500, not 200."*;
- the size limit off: *"expected 200 to be 400"*, and the fetch tests run into
  the timeout instead (*"expected 'The document took longer than 5 secon...' to
  contain 'over the 5120'"*);
- the timeout off: *"Test timed out in 20000ms."*

**Against the booted app** (`aspire start` in a worktree, 2026-10-28), the SDK's
client with `clientMetadataUrl` set to **Claude Code's real document**, fetched
over the real network under the real address rule:

```
client_id used: https://claude.ai/oauth/claude-code-client-metadata
no session -> 200 Sign in to connect the client at claude.ai
signed in -> 200 Allow Claude Code to use this catalogue as you?
   This client describes itself in a document at claude.ai. The name above is what that document says; the address is who published it.
   The answer will be sent to localhost:7781.
approved -> 302 http://localhost:7781/callback
whoami -> {"id":"d6d901ab-...","name":"developer","email":"developer@localhost","client":"https://claude.ai/oauth/claude-code-client-metadata"}
connections -> [[{"id":"https://claude.ai/oauth/claude-code-client-metadata","name":"Claude Code"},"localhost:7781"]]
client_id https://localhost/x.json -> 400 {"error":"invalid_client","error_description":"This client's metadata document was refused: localhost resolves to 127.0.0.1, which is a private or special-use address this server does not fetch from."}
client_id https://169.254.169.254/latest/meta-data -> 400 ... "169.254.169.254 resolves to 169.254.169.254, ..."
client_id https://10.0.0.1/client.json -> 400 ... "10.0.0.1 resolves to 10.0.0.1, ..."
```

**Not proved**: claude.ai itself choosing **Use Claude's published identity**
against a deployment, for the reason given for claude.ai below, and the real
`claude` CLI picking CIMD (it should, since the metadata now advertises it, but
its login opens a browser nobody here could press).

### Tokens: opaque, digested, bound to a grant

Read against Cloudflare's `workers-oauth-provider`
(<https://github.com/cloudflare/workers-oauth-provider>, `storage-schema.md`),
which is the most widely deployed implementation of this shape. It stores
tokens, codes and secrets only as SHA-256, groups every token under a **grant**,
issues access tokens for an hour and refresh tokens for thirty days, and revokes
by deleting the grant. This follows the same shape in four tables, migration
`0032`:

| Table | Holds |
| --- | --- |
| `oauth_client` | A registration: the SDK's metadata as JSON. No secret. |
| `oauth_consent` | A consent page not yet answered: the CSRF token's digest, the session's digest, the request. Ten minutes, single use. |
| `oauth_grant` | A person's approval of one client, which is **a connection**. Carries the one authorization code, as a digest, with its PKCE challenge, five minutes, and `code_used_at`. |
| `oauth_token` | An access or refresh token, as a digest, under a grant. |

**Every credential is stored as SHA-256**, for the argument `session` makes: a
copy of these tables is not a set of live credentials. Tokens are 32 random
bytes, opaque rather than JWTs, because the only thing that ever checks one is
this server, and a row it can revoke is worth more than a signature it cannot.

**Access tokens live an hour, refresh tokens thirty days and are single use.**
Each refresh revokes the token presented and issues a new pair, so the thirty
days slide with use, matching a session.

**A replay ends the connection.** A code exchanged twice, or a refresh token
presented after it was rotated, revokes the grant and every token under it
(RFC 6749 section 4.1.2, OAuth 2.1 section 4.3.1). Cloudflare instead keeps the
previous refresh token valid until the new one is used, to survive a lost
response; this takes the stricter reading, which is what Claude's documentation
describes, and the trade is that a refresh response lost in transit costs a
reconnection.

**Revoking either token revokes the grant** (RFC 7009 permits it), so a client
that disconnects is disconnected rather than left holding the other half.

### The audience: one resource, this server's `/mcp`

The resource is `BOOKSCAN_PUBLIC_ORIGIN` + `/mcp`, and nothing else is issued
for. A `resource` naming anything else is refused at `/authorize` with
`invalid_target`, and at `/token` likewise; `requireBearerAuth` is given
`expectedResource`, so a token whose grant names another resource is refused at
`/mcp`. A client that sends no `resource` gets a token for this one, since there
is no other; the specification makes sending it the client's obligation.

### The issuer is configuration, not the request

The issuer and `/mcp` are absolute URLs that appear in metadata a client
fetches. Behind Cloudflare the request's scheme and host are the tunnel's view,
so they come from **`BOOKSCAN_PUBLIC_ORIGIN`**, which already existed for the
same reason (a provider's redirect URI) and is already in `deploy/contract.json`.
No second variable was added: one origin, one meaning. `deploy/check-config.mjs`
now also refuses an origin with a path, query or fragment, since an RFC 8414
issuer may not carry the last two and the endpoints are at the root.

**Unset, the connector is off**: none of the seven doors is mounted, and the
start log says so both ways round. It is also off, rather than the process
refusing to start, on a plain `http` origin that is not `localhost` or
`127.0.0.1`, because OAuth 2.1 serves an authorization server over `https` only
and the SDK throws on any other issuer:

```
[mcp] the MCP connector is at http://localhost:36287/mcp, its own OAuth authorization server at http://localhost:36287
[mcp] the MCP connector is off: BOOKSCAN_PUBLIC_ORIGIN is empty, ...
```

The AppHost sets it to the api's own address in a checkout, so a checkout can be
connected to. Not Vite's: Vite proxies `/api` and nothing else.

### `/mcp`: stateless Streamable HTTP, bearer only, `enabled` every time

`POST /mcp` builds a fresh `McpServer` and a `StreamableHTTPServerTransport`
with `sessionIdGenerator: undefined` per request, and answers JSON rather than an
event stream. Nothing claude.ai's documentation says requires a session, and
stateless means nothing is held in memory to lose on a restart. `GET` and
`DELETE` answer `405` after the bearer check.

**A cookie is not a bearer.** `requireBearerAuth` reads `Authorization` and
nothing else. A cookie is sent by the browser on its own, so accepting one here
would let a page on another site drive tools with somebody's session.

**`enabled` is read on every request**, joined from `user` exactly as the gate
reads it for a session. A person who has been disabled is answered `403` with
`state: "waiting"` on their very next call, not `401`, because `401` would send a
client round its refresh loop for a token that is fine. Re-enabled, the same
token works again, the way a session does.

**No scopes.** There is one thing a token can do, which is act as the person who
approved it. #171 has not decided roles, and an unused scope that looks like
authorization is worse than none. `scopes_supported` is not advertised, so
claude.ai requests none.

### Rate limits, and whose address they count

The SDK rate-limits `/authorize`, `/token`, `/register` and `/revoke` per
`req.ip`, `/register` at twenty an hour. Behind a proxy that is the proxy's
address unless Express is told how many hops to believe, so
**`BOOKSCAN_PROXY_HOPS`** (`web/server/trust-proxy.ts`, `deploy/contract.json`)
is that count: 0 by default, 2 for a CDN in front of a reverse proxy. It is a
count and never `true`, because each proxy appends to `X-Forwarded-For` and
only the rightmost entries were written by them; `true` reads the leftmost,
which the client wrote. `web/server/trust-proxy.routes.test.ts` drives
`/register` to its limit at 0, 1 and 2 hops, with and without a client sending
the header itself.

Every 60 minutes, and once at start, the server deletes the `oauth_client` rows
older than a day that have no grant and no consent page waiting
(`web/server/mcp/sweep.ts`), since `/register` is open and nothing else would
ever remove them. A grant keeps its client even once revoked.

### Caching

Every answer at the seven doors says `Cache-Control: no-store`: RFC 6749 requires
it of a token response, and the rest carry it for the reason #566 gave. The SDK
sets it on its own four handlers and not on the metadata or on a bearer refusal,
so one middleware sets it at each mount. The routes under `/api/mcp` carry the
gate's `private, no-cache`.

### What a person can do about it

`GET /api/mcp/connections` lists the clients a person has connected, and
`DELETE /api/mcp/connections/:id` disconnects one, which revokes every token it
holds. Both are behind the gate and answer only about the caller's own. A
Settings screen over them is a follow-up.

**The owner can end all of them at once**, with the script that ends sessions
(#625):

```
npm run enable-user -- --target '<connection>' --sign-out <id|email>
```

revokes every grant the person holds, in the same transaction as their sessions,
and prints `Revoked N MCP connection(s) for <id>`. It goes through the same one
statement `DELETE /api/mcp/connections/:id` does (`OAuthStore.revokeGrant` and
`revokeEveryGrantOf` share it), so there is one way a connection ends.
`--disable` revokes nothing: `/mcp` answers a disabled person `403` on their next
call, and the same token works again once they are let back in, the way a
session does.

---

## The tool surface

For #617 and #618. The tools are `web/server/mcp/tools.ts`,
`web/server/mcp/read-tools.ts` and `web/server/mcp/write-tools.ts`; how every
tool answers is `web/server/mcp/answers.ts`.

### The tools

| Tool | Calls | What it answers |
| --- | --- | --- |
| `search_books` | `ListBooksHandler` | One page of short book records, filtered by words, ISBN, tags, range, author, state and placement |
| `get_book` | `GetBookHandler`, `TagsOfBookHandler` | One book in any state, queued included: record, place, tags, credits, which photographs exist |
| `collection_summary` | `CountBooksHandler`, `CountQueueHandler` | The counts the first screen shows: the catalogue's, and the queue's as `ready_to_shelve`, `stuck` and `being_read` beside them, never inside `total` |
| `list_queue` | `ListQueueHandler` | The scanning queue, paged and optionally narrowed by status, in the first screen's words. Reads only, and says a queued book is finished in the app by the person holding it, never by `add_book` |
| `list_tags` | `VocabularyHandler` | The vocabulary, or the part under one slug, with rolled-up counts |
| `list_authors` | `ListAuthorsHandler` | People, each with every name they publish under, paged and optionally narrowed by name |
| `get_author_books` | `BooksByAuthorHandler` | One person and every book crediting them, in any state, paged |
| `lookup_isbn` | `LookupIsbnHandler` | What Open Library and Google Books hold for a number, and whether this collection has it. Writes nothing |
| `whoami` | `AuthStore` | Which person the connection acts for |
| `add_book` | `LookupIsbnHandler`, then `CatalogueBookHandler` | Looks the ISBN up and catalogues it where it lands, or answers the book already here with `added: false` |
| `update_book` | `GetBookHandler`, then `ReviseBookHandler` | Changes only the fields passed; `reidentified` and `withdrawn_tags` say what an ISBN change took off |
| `tag_book` | `ApplyTagHandler` | Puts a book under a tag as the person |
| `untag_book` | `RemoveTagHandler` | Takes a book out of a tag, whoever applied it |

Every one takes its handlers from `createApp`, which builds them once; `/mcp`
makes a fresh `McpServer` per request and hands it the same handlers, so a
tool never opens a pool or a store of its own. `lookup_isbn`'s handler sits in
front of `server/lookup.ts` through a `CatalogueLookup` port
(`web/application/lookup/read-models.ts`), and `GET /api/lookup/isbn/:isbn` now
calls the same handler.

`search_books` filters by author, so `CatalogueFilter` gained `authorId`: the
one listing was widened rather than a second one written, as AGENTS.md asks.

`list_queue` reads the same list `GET /api/captures` answers, through the same
handler, and leaves out who holds a book (`claimed_by`, `claimed_at`), who last
edited it, the raw drafts and every filename. A claim is somebody at a phone
mid-task, and no tool acts on the queue, so there is nothing a model could do
with it. Its `title` and `authors` are what a person typed over what the lookup
found, field by field, which is the rule the queue screen draws by; `title_guess`
stays apart because it is the camera's reading, never a title.

### What was read, and what it changed

- **The specification's tools page** (2025-11-25,
  <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>).
  A tool that returns `structuredContent` **SHOULD** also return the serialized
  JSON in a text block, for clients that predate structured content; with an
  `outputSchema` the server **MUST** conform to it, and the SDK checks this on
  every call, so a test that calls a tool is also a test of its schema. Errors a
  model can correct (a bad tag, an unknown id) are **tool execution errors**,
  `isError: true` with a message, not JSON-RPC errors, because clients hand the
  first to the model and may not hand it the second. Names: 1 to 128
  characters, letters, digits, `_`, `-`, `.`.
- **The annotations** (`ToolAnnotations` in the same revision). `readOnlyHint`
  defaults to **false**, `destructiveHint` to **true** and `openWorldHint` to
  **true**, so a tool that says nothing is assumed to be a destructive call to
  the open world. Every tool here says all of what applies. `destructiveHint`
  and `idempotentHint` mean something only when `readOnlyHint` is false.
  Clients must treat annotations as untrusted hints; they describe, they do not
  protect.
- **Anthropic's "Writing effective tools for agents"**
  (<https://www.anthropic.com/engineering/writing-tools-for-agents>). Describe a
  tool as to a new colleague, with this app's vocabulary spelled out; name
  parameters unambiguously (`book_id`, not `id`); return high-signal fields
  rather than everything a row holds; page, because Claude Code truncates a tool
  answer at about 25,000 tokens; and make an error say how to fix the call. This
  is what moved the default page from the `/api` listing's 500 to **25**, with a
  ceiling of **100**, and what took the internal columns (`draft_json`,
  `ocr_text`, `sort_key`, the hashes) out of every answer.
- **GitHub's MCP server** (<https://github.com/github/github-mcp-server>), as
  the most used example: snake_case `verb_noun` names (`search_issues`,
  `list_issues`), a page size with a stated maximum, and descriptions that say
  what an omitted filter means. Its `owner`/`perPage` mix of cases is the thing
  not copied.
- **Resources.** Claude's connector clients surface a server's resources as
  something a *person* attaches from a menu; tools are what the model chooses to
  call. Searching a collection is the model's choice, so there are no resources.

### The conventions, which #618 follows

1. **Names are snake_case `verb_noun`**, and the noun says which thing:
   `search_books`, `get_book`, `list_tags`. Write tools read the same way
   (`add_book`, `apply_tag`).
2. **Arguments and answers are snake_case, and ids say what they identify**:
   `book_id`, `author_id`. An answer never says `id` alone.
3. **Every tool declares an input schema and an output schema with zod**, and
   every field a model could misread carries a `.describe()` in this app's
   words: a range is fiction or non-fiction, a tag is a slug path such as
   `genre/fiction/weird` that matches itself and anything beneath it, a location
   is the label the shelves print.
4. **A description says what comes back, what an omitted filter means, and which
   tool to call next.** That last part is how a model finds `book_id` and
   `author_id` without guessing.
5. **Every answer is `answer(data)`**: `structuredContent` and the same object
   as JSON in one text block.
6. **Every refusal a model can act on is `refuse(text)`**, an `isError` result
   that names the tool which answers the question (`search_books finds book
   ids`). Arguments outside the schema (a page of 1000) are refused by the SDK
   before the tool runs, the same way.
7. **Listings are paged**: `limit` (default 25, at most 100) and `offset` in,
   `total`, `offset`, `limit` and `next_offset` (null on the last page) out.
   `list_tags` is the exception and says so: the vocabulary is tens of words.
8. **Every tool states its annotations.** The read tools say `readOnlyHint:
   true`. `openWorldHint` is `false` for everything that reads only this
   catalogue and `true` for `lookup_isbn`, which asks two outside services. A
   write tool says `readOnlyHint: false` and states `destructiveHint` and
   `idempotentHint` explicitly, since their defaults are the pessimistic ones.
9. **Every tool calls `actingFor(extra.authInfo)` first**, so none can run for
   nobody. The read handlers do not take the person, because the catalogue is
   one collection; the write handlers will.
10. **No URL a client cannot fetch.** The photographs are served under `/api`,
    behind the session cookie, and a bearer token is not a session (above). So
    `get_book` says which photographs exist (`photographs: ["front", "cover"]`)
    and nothing more. `lookup_isbn` does pass the catalogue's own `cover_url`,
    because that is on Open Library's or Google's host and anybody can fetch
    it. Serving a photograph to a connected client, as image content or a
    resource behind the bearer, is a follow-up.

### The write tools, and what each decided

- **`add_book` is the save a scan makes.** The lookup record becomes a draft
  exactly as the review pane's does (`draftFromRecord` in
  `web/server/book-commands.ts`, the server's copy of `draftFromLookup` in
  `src/lib/api.ts`), then `catalogueCommandOf` and `CatalogueBookHandler`, with
  no plank named, so the book is recorded where it lands. A `genre` passed is the
  person's answer (`classificationSource: 'manual'`); omitted, the catalogues'
  heading is saved as the classifier's guess, as a scan saves it. The ISBN
  source is `manual`, the value the app writes for a typed number.
- **A number already catalogued adds nothing**: the existing book comes back
  with `added: false`, and nothing passed with it is applied.
- **A number neither catalogue knows is refused unless the caller passes
  `title`** (and `authors`), which the description says must come from the
  person and never from memory. The app allows the same thing ("No catalogue
  has ... fill the rest in by hand"), so refusing outright would leave some real
  books impossible to add here. The not-found record's default genre is not
  used, because nothing stated it.
- **Two `add_book` calls for one ISBN at the same moment add it once** (#637).
  The lookup's duplicate check is a read outside any unit of work, so
  `add_book` asks `CatalogueBookHandler` to answer a book already catalogued
  (`ifCatalogued: 'answer-it'`), and the handler asks again inside its unit of
  work under an `isbn:<isbn13>` lock. The second call waits for the first to
  commit and answers its book with `added: false`. A save from the app takes
  the same lock, so `add_book` also answers a book the app saved in that gap.
  `idempotentHint` is still `false`, as it was set by #618; whether to raise it
  now that a repeat at any moment is harmless is a separate decision.
- **`update_book` is PATCH over `ReviseBookHandler`**: the current record is
  read through `GetBookHandler`, which also answers the printed names
  (`printed`), because `authors` joined with a comma cannot be split back when a
  name has a comma in it. Absent `genre` states nothing, so the book keeps its
  tags and its run. A book in the queue, or discarded, is refused: revising it
  would shelve it with no plank. Moving a book is not offered.
- **Nobody is recorded by name**, because no command takes a person: a tag says
  `source = 'person'` and a placement `actor = 'person'`, which is what the app
  writes. `edited_by` belongs to the queue and holds a device, and no save
  writes it.

---

## What was proved

**By the SDK's own client**, in `web/server/mcp/connector.routes.test.ts`,
against a real Postgres: discovery from a `401`, DCR, the browser half with a
session made the way the other route tests make one, consent, the exchange,
`whoami` answering the session's own user id, a refresh through the SDK's
`auth()`, revocation, and `401` afterwards. Beside it: a disabled user answered
`403` on the next call and served again once re-enabled; a reused code refused
and the first exchange's token then refused; a wrong PKCE verifier refused; a
reused refresh token refused and the connection ended; a foreign `resource`
refused with `invalid_target`; somebody with no session sent through the
development door and back to the same request; the waiting page; Deny; a consent
answer from another session refused and spent; the consent page's framing
headers; a cookie at `/mcp` and a bearer under `/api` both `401`; a non-loopback
`http` redirect refused at registration; and, beside a built client, `/mcp` and
`/authorize` answered by the connector rather than the single-page fallback.

Reverting the protections and running it again: with the `enabled` check
removed, *"expected 200 to be 403"*; with the replay revocation removed, the
reused code and the reused refresh token both *"expected 200 to be 401"*.

**By the booted app**, under `aspire start` in a worktree, on 2026-10-28:

```
$ curl -i http://localhost:36287/.well-known/oauth-protected-resource/mcp
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"resource":"http://localhost:36287/mcp","authorization_servers":["http://localhost:36287/"],"resource_name":"Book catalogue"}

$ curl -i -X POST http://localhost:36287/mcp
HTTP/1.1 401 Unauthorized
Cache-Control: no-store
WWW-Authenticate: Bearer error="invalid_token", error_description="Missing Authorization header", resource_metadata="http://localhost:36287/.well-known/oauth-protected-resource/mcp"

{"error":"invalid_token","error_description":"Missing Authorization header"}
```

and the whole flow by hand with `curl`, through the development door:

```
$ POST /register
{"redirect_uris":["http://localhost:7777/callback"],"client_name":"curl, by hand","client_id":"9c658c6f-…","client_id_issued_at":1793166697,"token_endpoint_auth_method":"none"}
$ GET /authorize with no session                       -> 200 "Sign in to connect curl, by hand"
$ GET /authorize signed in through the development door -> "Allow curl, by hand to use this catalogue as you?"
$ POST /api/mcp/consent decision=approve
Location: http://localhost:7777/callback?code=<redacted>&state=s1
$ POST /token
{"access_token":"<redacted>","token_type":"Bearer","expires_in":3600,"refresh_token":"<redacted>"}
$ POST /mcp tools/call whoami
{"result":{"content":[...],"structuredContent":{"id":"10cc824e-…","name":"developer","email":"developer@localhost","client":"9c658c6f-…"}},"jsonrpc":"2.0","id":2}
$ POST /token again, same code
{"error":"invalid_grant","error_description":"This authorization code was already used. Every token issued from it has been revoked."}
$ POST /mcp with the first token, after that replay      -> 401
$ POST /mcp with only the session cookie                 -> 401
$ GET /api/health with only the bearer                   -> 401
```

**By the browser suite** (#619), on every pull request:
`e2e/features/connecting-claude.feature` registers the SDK's client against the
booted app, sends a signed-out browser to `/authorize`, signs in through the
development door, presses Allow on the real consent page, receives the code on
a loopback listener the way Claude Code does, exchanges it, and calls
`search_books` and `add_book`; the added book is then read back out of
Postgres. A second scenario presses Deny and gets `access_denied`.

**By Claude Code itself**, on 2026-10-28, against a checkout:
`claude mcp add --transport http` and `claude mcp login` registered as
`Claude Code (<name>)`, the consent page warned about the loopback redirect,
and `claude -p` then called `whoami`, `add_book` and `search_books`. One thing
learned there and written into the how-to: `claude mcp remove` forgets the
tokens locally and **does not revoke the connection here**; it was still listed
by `GET /api/mcp/connections` until it was deleted there.

**Not proved, and it needs a deployment this repository must never describe:**
claude.ai itself connecting. That needs a public `https` origin claude.ai can
reach, and is the owner's to try once this is deployed.

---

## Known gaps, each a follow-up

- **Close `/register` to all but loopback clients**, now that claude.ai can use
  CIMD. That would retire most of #624's sweep. Not done here: a claude.ai
  connector added with **Register automatically** before this change would stop
  reconnecting.
- **CIMD's optional extras.** A document's `logo_uri` is dropped rather than
  fetched and shown, and nothing requires a non-loopback redirect to share the
  document's origin (the draft's section 6.1 "MAY"). The consent page shows
  both hosts instead.
- **A host allowlist for documents.** The address rule keeps the fetch off the
  home network; it does not limit which public hosts may be named. A deployment
  that wants only `claude.ai` could add one, which is the specification's
  "trust policy" option.
- **A Settings screen** over `GET /api/mcp/connections`.
- **Photographs over MCP.** The read tools say which photographs exist and never
  link to them, because the links need the session cookie. Image content in a
  tool result, behind the bearer, would let Claude see a cover.
- **A missing `Authorization` header is answered `error="invalid_token"`.** RFC
  6750 section 3.1 says a request with no credentials should carry no error
  code. It is the SDK's `requireBearerAuth`, it changes nothing for Claude, which
  only needs the `401` and the pointer, and it is not worth replacing the SDK's
  middleware over.
