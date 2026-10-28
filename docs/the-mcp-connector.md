# The MCP connector: how a Claude signs in as a person

For #613, the first child of #612. A person who is signed in and let in can add
this app as a custom connector in claude.ai (or `claude mcp add --transport http`
in Claude Code), approve it in the browser, and the client then holds a token
that calls tools **as that person**. One tool, `whoami`, proves the chain; the
catalogue tools are later children of #612.

This page is the explanation and the research behind it. `docs/the-gate.md` has
the doors and the count; the code is `web/server/mcp/` and
`web/infrastructure/auth/oauth-store.ts`.

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

### Clients are public, and registered by DCR

claude.ai registers through DCR when the server does not advertise CIMD, and
both make it a public client. So **every client is registered public**, whatever
it asks for: RFC 7591 lets the server replace requested metadata, and the
response says `token_endpoint_auth_method: "none"`. There is then no client
secret to store, which matters because the SDK compares a secret as plain text
and so could only check one this server kept in the clear.

**Redirect URIs must be `https`, or `http` to `localhost`, `127.0.0.1` or
`[::1]`, with no fragment.** Matching is the SDK's: exact, except that a loopback
port is ignored, as RFC 8252 section 7.3 requires and Claude Code needs.

**CIMD is not supported yet.** It is a SHOULD in this revision and claude.ai
falls back to DCR without it. Supporting it means fetching a URL a stranger
names, with the SSRF care the specification spells out, and that is its own
change. Follow-up below.

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

**Not proved, and it needs a deployment this repository must never describe:**
claude.ai itself connecting. That needs a public `https` origin claude.ai can
reach, and is the owner's to try once this is deployed.

---

## Known gaps, each a follow-up

- **CIMD.** A SHOULD, and Claude Code prefers it when advertised. Needs an
  outbound fetch with SSRF limits and a cache.
- **Registrations are never swept.** DCR registers a client per fresh
  connection, and `/register` is open, rate-limited by the SDK to twenty an hour
  per address. Behind a tunnel every request has one address, so that limit is
  global, which is safe and could be tight. A sweep of clients with no grant
  after some days belongs with it.
- **`enable-user --sign-out` does not revoke connections.** It revokes sessions,
  which is "lost phone"; a connected client is another credential the person
  holds and arguably belongs in the same switch.
- **A Settings screen** over `GET /api/mcp/connections`.
- **A missing `Authorization` header is answered `error="invalid_token"`.** RFC
  6750 section 3.1 says a request with no credentials should carry no error
  code. It is the SDK's `requireBearerAuth`, it changes nothing for Claude, which
  only needs the `401` and the pointer, and it is not worth replacing the SDK's
  middleware over.
