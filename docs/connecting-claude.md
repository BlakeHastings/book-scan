# Connecting Claude to book-scan

How to add your book-scan catalogue to Claude as a connector, so Claude can
search it and add, edit and tag books as you. It covers claude.ai and the
Claude apps, Claude Code, what you will be asked to approve, how to disconnect,
and what to check when it does not work.

This page is steps. Why the connector is built the way it is, and what each
tool does, is in [`the-mcp-connector.md`](the-mcp-connector.md). Throughout,
`<your host>` is the host name your deployment is reached on; nothing here
needs a real one.

Checked against Anthropic's documentation on 2026-10-28:
[Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted),
[Authentication for connectors](https://claude.com/docs/connectors/building/authentication)
and [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp).
Menu names in the Claude apps move; if one below is not where it says, those
pages are the authority.

---

## Before you start

1. **Serve the app over `https`, and tell it its own origin.** Set
   `BOOKSCAN_PUBLIC_ORIGIN` to the origin people type, scheme and host only,
   with no path and no trailing slash:

   ```
   BOOKSCAN_PUBLIC_ORIGIN=https://<your host>
   ```

   The connector's address is that origin plus `/mcp`, and a client must use
   exactly that address.

2. **If anything sits in front of the app, count it.** Set
   `BOOKSCAN_PROXY_HOPS` to the number of proxies between the internet and the
   server: `1` for one reverse proxy or tunnel, `2` for a CDN in front of a
   reverse proxy. Leave it at `0` only when nothing is in front.

3. **Let Claude reach it, and let it reach Claude.** claude.ai, Claude Desktop
   and the mobile apps connect from Anthropic's servers, not from your device,
   so `https://<your host>` has to be reachable from the public internet. If you
   restrict who may connect, allow Anthropic's outbound range,
   `160.79.104.0/21`
   ([IP address reference](https://platform.claude.com/docs/en/api/ip-addresses)).
   Claude Code connects from the machine it runs on.

   The other direction matters too: when a client uses its published identity,
   book-scan fetches that client's document over `https` (from `claude.ai`, for
   Claude), so the server needs outbound `https` to the internet. It never
   fetches from a private or local address.

4. **Restart, and read the start log.** One line says whether the connector is
   on:

   ```
   [mcp] the MCP connector is at https://<your host>/mcp, its own OAuth authorization server at https://<your host>
   ```

   If it says `the MCP connector is off`, see
   [The connector is off at startup](#the-connector-is-off-at-startup).

5. **Make sure the person connecting is let in.** They sign in to the app once
   in a browser, and the owner enables them:

   ```bash
   cd web
   npm run enable-user -- --target '<connection>'                  # lists everyone, writes nothing
   npm run enable-user -- --target '<connection>' --enable <id|email>
   ```

   On an image, the same script is `node dist-server/enable-user.js` (see
   [`the-gate.md`](the-gate.md#how-somebody-gets-let-in)).

---

## Connect from claude.ai, Claude Desktop or the Claude mobile apps

These share one connector list per account. Add the connector once, on the web
or in the desktop app, and use it from any of them.

### On a Free, Pro or Max plan

1. Go to **Customize > Connectors**.
2. Click **Add custom connector**.
3. Give it a name, for example `book-scan`.
4. For the URL, enter `https://<your host>/mcp`.
5. If the dialog asks you to choose authentication settings:
   - **Authentication**: **Sign in now**.
   - **OAuth client**: **Use Claude's published identity**, the dialog's
     recommended option. book-scan reads Claude's client details from the
     document Anthropic publishes, so nothing is registered.
     **Register automatically** works too.
   - **Request headers**: leave empty.

   If instead the dialog shows **Advanced settings**, leave the OAuth client ID
   and secret empty.
6. Click **Add**, then **Connect** if Claude asks. A browser window opens on
   `https://<your host>/authorize`.
7. Sign in if you are asked to, then press **Allow** on the consent screen
   ([what it shows](#what-the-consent-screen-shows)). The window returns to
   Claude and the connector reads as connected.

The Free plan allows one custom connector.

### On a Team or Enterprise plan

An Owner adds the connector once for the organization, and each member then
connects as themselves:

1. The Owner goes to **Organization settings > Connectors**, selects **Add**,
   then **Custom**, and **Web** if asked.
2. The Owner enters `https://<your host>/mcp`, leaves any OAuth client ID and
   secret empty, and clicks **Add**.
3. Each member goes to **Customize > Connectors**, finds the connector labelled
   **Custom**, and clicks **Connect**, then signs in and allows it as above.

Each member is a separate person to book-scan, so each has to be enabled
(step 5 of [Before you start](#before-you-start)).

### Use it in a conversation

Click **+** in the chat box, then **Connectors**, and turn `book-scan` on for
that conversation. Ask for something it can answer, such as "how many books are
in my catalogue?".

---

## Connect from Claude Code

1. Add the server:

   ```bash
   claude mcp add --transport http book-scan https://<your host>/mcp
   ```

   This adds it for you in the current project. Add `--scope user` to have it in
   every project.

2. Check it was added. It reads as needing sign-in until you do the next step:

   ```bash
   claude mcp list
   ```
   ```
   book-scan: https://<your host>/mcp (HTTP) - ! Needs authentication
   ```

3. Sign in. Either start Claude Code and run `/mcp`, choose `book-scan` and
   authenticate, or from the shell:

   ```bash
   claude mcp login book-scan
   ```

   A browser opens on `https://<your host>/authorize`. If it does not, copy the
   address Claude Code prints and open it yourself, on the same machine.

4. Sign in if asked, then press **Allow**
   ([what it shows](#what-the-consent-screen-shows)). The browser is sent back
   to `http://localhost:<port>/callback`, where Claude Code is waiting, and
   Claude Code says:

   ```
   Authenticated with "book-scan". Its tools are now available in Claude Code.
   ```

5. Check:

   ```bash
   claude mcp list
   ```
   ```
   book-scan: https://<your host>/mcp (HTTP) - ✔ Connected
   ```

Claude Code refreshes the token by itself. A connection that is not used for
thirty days has to be signed in again.

### Trying it against a development checkout

A checkout started with `aspire start` has the connector on, at the api's own
port rather than Vite's, and the development door signs you in. Read the
address off the log and use it in place of `https://<your host>/mcp`:

```bash
aspire logs api | grep '\[mcp\]'
claude mcp add --transport http book-scan-dev http://localhost:<api port>/mcp
claude mcp login book-scan-dev
```

On the sign-in page, choose **Sign in with this machine**. Remove it when you
stop the checkout (`claude mcp remove book-scan-dev`), since the port changes
on every start.

---

## What the consent screen shows

The browser lands on a page served by book-scan itself, not by Claude. Which
page depends on who is signed in to book-scan in that browser:

| You are | The page says | What to do |
| --- | --- | --- |
| Not signed in | **Sign in to connect** *client*, with one button per sign-in provider | Sign in. You come back to this same request and see the consent page |
| Signed in, not let in yet | **You are signed in, but not let in yet** | Ask the owner to enable you, then start the connection again from Claude |
| Signed in and let in | **Allow** *client* **to use this catalogue as you?** | Read it, then **Allow** or **Deny** |

The consent page names:

- **the client**, by the name it gave. A client using its published identity
  shows that document's name and, under it, the host the document came from,
  for example `Claude Code` and `claude.ai`. The host is the part to read: any
  document can call itself Claude, and only Anthropic can publish one on
  `claude.ai`. A client that registered shows only its name; Claude Code
  registering shows `Claude Code (<the name you gave it>)`;
- **who you are signed in as**, normally your email address;
- **where the answer will be sent**, as a host. From claude.ai and the Claude
  apps it is `claude.ai`. From Claude Code it is `localhost:<port>`, and the page
  adds a warning that any program on your computer could claim that address.
  Allow it only if you started the connection yourself, just now.

**Allow** connects the client as you: it can read the catalogue and add, edit
and tag books, until you disconnect it. It cannot delete books. **Deny** sends
the client back with nothing. The page expires ten minutes after it was opened.

---

## Disconnect a client

Disconnecting in Claude and disconnecting in book-scan are two different
things. **Removing the connector in Claude only makes Claude forget its tokens;
the connection stays valid in book-scan** until it is revoked there. Do both
when you mean it.

### In Claude

- claude.ai and the apps: **Customize > Connectors**, then **Remove** or the
  three-dot menu next to `book-scan`. Team and Enterprise Owners remove it for
  everyone from **Organization settings > Connectors**.
- Claude Code: `claude mcp remove book-scan` forgets the server and its tokens.
  `claude mcp logout book-scan`, or **Clear authentication** in `/mcp`, forgets
  only the tokens.

### In book-scan, one connection

1. In book-scan, open the corner menu and choose **Settings**.
2. Under **Apps that use your books as you**, find the client. Each row shows
   the name the client gave itself and, boxed beside it, the address its
   approval was sent to. Any app can call itself "Claude", so the address is
   what tells two of them apart: `claude.ai` for claude.ai and the Claude apps,
   `localhost:<port>` or `127.0.0.1:<port>` for Claude Code.
3. Press **Disconnect** under it, and **Disconnect** again when asked.

Every token that connection held stops working at once, and the card says
**Nothing is connected** when it was the only one.

Without the screen, the same two requests work from a browser signed in to
book-scan: `GET /api/mcp/connections` lists your own connections with an `id`
each, and `DELETE /api/mcp/connections/<id>` answers `204` when it is gone and
`404` when there is no such connection of yours.

### In book-scan, every connection a person has

For a lost phone or laptop, the owner signs the person out of everything,
which ends their sessions and revokes every connection in one step:

```bash
cd web
npm run enable-user -- --target '<connection>' --sign-out <id|email>
```
```
Ended 1 session(s) for <id>.
Revoked 1 MCP connection(s) for <id>, and every token issued under them. Each client has to be approved again to reconnect.
```

`--disable` is different: it shuts the person out but leaves their
connections in place, answered `403` until they are enabled again.

---

## When it does not work

Find the symptom, then the check.

### The connector is off at startup

The start log says why, in one of two ways:

```
[mcp] the MCP connector is off: BOOKSCAN_PUBLIC_ORIGIN is empty, and the issuer and /mcp are absolute URLs this server will not guess
```

Set `BOOKSCAN_PUBLIC_ORIGIN` ([Before you start](#before-you-start), step 1).

```
[mcp] the MCP connector is off: http://<your host> is neither https nor localhost, and OAuth 2.1 serves an authorization server over https only
```

The origin is plain `http`. Serve the app over `https` and set the origin to
the `https` one. If TLS ends at a proxy in front of the app, the origin is still
the `https` address people type.

While the connector is off, `https://<your host>/mcp` is not answered by the
connector at all, and Claude reports that it could not reach the server.

### Claude says it couldn't reach the server

1. From outside your network, check the server answers and points at its
   metadata:

   ```bash
   curl -i -X POST https://<your host>/mcp
   ```

   Expect `401 Unauthorized` and a header
   `WWW-Authenticate: Bearer ... resource_metadata="https://<your host>/.well-known/oauth-protected-resource/mcp"`.
   Anything else, a `200` page included, means the request is not reaching the
   connector: check the start log line and your proxy's routes for `/mcp`,
   `/authorize`, `/token`, `/register`, `/revoke` and `/.well-known/`.

2. Check the metadata names the address you typed:

   ```bash
   curl -s https://<your host>/.well-known/oauth-protected-resource/mcp
   ```

   `resource` must be exactly the URL you gave Claude, `https://<your host>/mcp`.
   If it differs (another host, `http`, a port), fix `BOOKSCAN_PUBLIC_ORIGIN` or
   the URL you typed so they agree.

3. For claude.ai and the apps, check Anthropic's range is allowed through
   ([Before you start](#before-you-start), step 3).

### Sign-in goes round in a loop, or the connector keeps asking you to sign in

Claude asks again whenever the server answers `401`.

- **The URL does not match.** A trailing slash, `http` for `https`, or another
  host name is a different resource, and its tokens are refused. Use exactly
  `https://<your host>/mcp` and the origin in `BOOKSCAN_PUBLIC_ORIGIN`.
- **Something in front strips the `Authorization` header.** Every call to `/mcp`
  carries the token there and nothing else; a session cookie does not count.
  Check that your proxy forwards `Authorization` to `/mcp`.
- **The connection was revoked**, by somebody disconnecting it, by
  `enable-user --sign-out`, or because a refresh token was used twice (which
  ends the connection on purpose). Remove the connector in Claude and connect
  again.
- **Thirty days without use.** The refresh token has expired; connect again.

### The browser says "You are signed in, but not let in yet" (403)

The account you signed in with is not enabled. The owner enables it
([Before you start](#before-you-start), step 5), and you start the connection
again from Claude.

A connection that worked and now answers `403` means the person was disabled
since. It keeps its tokens: once they are enabled again, it works without
reconnecting. Claude Code shows such a server as needing authentication.

### The browser shows "This client's metadata document was refused"

```json
{"error":"invalid_client","error_description":"This client's metadata document was refused: ..."}
```

The connection used a published identity, and book-scan could not accept the
document it names. The rest of the message says why. "The document at
claude.ai could not be fetched" or "took longer than 5 seconds" means the
server has no outbound `https` to the internet, or the publisher was down: check
[Before you start](#before-you-start), step 3, and try again. Anything else
means the document itself was refused, which for Claude's own should not
happen. In either case, removing the connector and adding it again with
**Register automatically** connects without the document.

### The browser says "This request has expired"

The consent page was answered already, is more than ten minutes old, or was
answered while signed in as somebody else. Start the connection again from
Claude.

### Registration is refused with 429 Too Many Requests

```json
{"error":"too_many_requests","error_description":"You have exceeded the rate limit for client registration requests"}
```

Registration is limited to 20 an hour per address, and the token, authorization
and revocation endpoints have limits of their own. The response's `Retry-After`
says how many seconds remain. If it happens on the first try of the day, the
server is almost certainly counting your proxy's address for everybody:
check `BOOKSCAN_PROXY_HOPS` ([Before you start](#before-you-start), step 2).
Every claude.ai connection arrives from Anthropic's range, so with the count
right the limit applies per Anthropic address, not to the whole internet at
once.

### Claude Code's browser never comes back

After **Allow**, the browser is sent to `http://localhost:<port>/callback`, on
the machine Claude Code runs on. If you opened the sign-in address on a
different machine, that redirect fails. Copy the whole address from the
browser's address bar and paste it where Claude Code asks for it, or sign in
from a browser on the same machine.
