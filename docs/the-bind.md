# The bind: making the last line a choice, with the default where it was

For #539, under epic #471. `docs/the-image.md` built something a host can point
at, `docs/publishing.md` gave it a registry and a contract, and both of them
stopped at the same sentence: **the server binds `127.0.0.1`, so inside a
container a published port reaches nothing.** #520, #532 and #533 each left that
alone deliberately, and each was right to, because opening a bind inside a change
about something else is the wrong place to take that decision.

This is the place. It is an explanation rather than a deployment guide, and it
chooses no host: what it does is turn one line of this repository's code into one
line of a deployment's configuration, and then argue about the default.

Every transcript below was produced on 2026-09-04 by building the image and
running it, on Docker 29.7.2 with a `linux/amd64` engine.

---

## What it is, in three lines

```
docker run -d -p 8080:3001 … book-scan                        # empty reply
docker run -d -p 8080:3001 -e BOOKSCAN_BIND=all … book-scan   # the app
docker run -d -e BOOKSCAN_BIND=0.0.0.0 … book-scan            # exits 1, loudly
```

`BOOKSCAN_BIND` takes one of two words. `loopback` is `127.0.0.1` and is what
unset, empty and blank all mean. `all` is `0.0.0.0`, every interface in the
container's network namespace. Anything else is refused at start.

`deploy/contract.json` declares it like every other input, `deploy/check-config.mjs`
checks it before a container starts, and `scripts/check-deploy-contract.mjs` holds
four facts about it to `web/server/bind.ts` and `web/server/index.ts` on every
pull request: the variable's name, what each word means, which word is the
default, and that the listen call takes what those produced.

---

## Decision 1: the default does not move, and the gate is the reason

The obvious argument for opening the bind is that there is a gate now. #523 put
one in front of the seventy-two unauthenticated doors `docs/auth-surface.md`
counted, so listening on an interface is no longer the act it was in July.

**That is the argument for the option and it is the argument against changing the
default.** The app was reachable and unauthenticated on a home network for
months. What ended that was the gate, not the bind, and a default that assumes
the gate is correct is a default that stops being safe on the day the gate has a
hole. Two things that have to be wrong at once is worth keeping when keeping it
costs one variable in a deployment that has already decided it wants to be
reachable.

There is a second reason, less about security and more about what a default is
for. **Every deployment that has not thought about this gets the default**, and
the deployments that have not thought about it are exactly the ones that should
not be listening on an interface. A deployment that has thought about it can say
so in eleven characters.

So: nothing that works today changes, nobody gets a listener they did not ask
for, and the `0.x` line in `docs/publishing.md` (*the contract is still moving
because the bind might*) is now answered without a major bump, because this adds
an optional variable and takes nothing away.

---

## Decision 2: two words, and an address is refused

An address is the obvious shape for this variable, and it is the wrong one.

**There are only two answers that mean anything from inside a container.** Either
only something sharing the network namespace can reach the server, or anything
that can route to the container can. A narrower interface address is assigned by
the runtime when the container starts, is not knowable when the variable is set,
and changes when the container is replaced. A deployment that wrote one down
would have a value that was right once and a container that will not start the
next time, with `EADDRNOTAVAIL` and nothing else to read.

**A word also records the decision rather than the keystroke.** `0.0.0.0` in a
deployment's configuration says what somebody typed. `all` says what they chose,
in the same vocabulary the start log and the configuration checker use back to
them, and it is greppable across a private repository in a way an address is not.

The cost of this is real and worth naming: **`0.0.0.0` is what everybody types**,
so the commonest thing a deployer will do is the thing this refuses. That is why
the refusal names the word to use instead, and why `check-config.mjs` catches it
before a container is scheduled rather than after. A refusal that only says no is
a refusal that gets worked around.

`all` is IPv4. There is deliberately no third word for IPv6: nothing has asked
for one, `EXPOSE` and a published port are IPv4, and an option nobody exercises
is an option nobody knows is broken.

---

## Decision 3: what it refuses, and that it does not fall back

`web/server/bind.ts` throws for any value it does not recognise, and
`server/index.ts` calls it beside `signInFrom`, before `bootstrap`, so the
process exits at start with the variable named in front of whoever is watching it
come up. That is the shape of the six refusals this app already makes, and the
refusal is `bind-that-is-not-a-word` in the contract's own list.

**The alternative is worse than it looks.** A server that ignored a value it did
not understand and quietly used the default would give a deployment that asked to
be reachable, was not, and looked exactly like the bind it was trying to change:
the container up, the log saying it is listening, and every request refused at
the socket. That is the failure this variable exists to end, so producing it by
accident would be a poor trade.

Refusing an address is a decision that has to survive being met at an awkward
moment, so the message makes the whole case rather than naming the file that
does:

```
$ docker run --rm -e BOOKSCAN_BIND=0.0.0.0 … book-scan:539
BOOKSCAN_BIND is "0.0.0.0", which is not one of the two words it takes.

  loopback  127.0.0.1, and the default. Only something inside this
            machine or this container's network namespace can reach the
            server, so publishing a container port reaches nothing.
  all       0.0.0.0, every interface in the namespace. Anything that
            can route to this container reaches the sign-in gate, which is
            then the only thing in front of the catalogue.

It is a word rather than an address on purpose. …
```

---

## Decision 4: it should be impossible to be wrong about which interface

The start log already says four things both ways round: telemetry, the backup
directory, the built client, and the doors. Each of them is there for the same
reason. The state is invisible from outside the process, and the quiet outcome is
the one that gets missed. The bind is the same shape and worse, because the two answers
differ by one character in an address and by everything else in what they mean.

So the address is printed, and then what it means:

```
[api] listening on http://127.0.0.1:3001
[api] bound to loopback only (BOOKSCAN_BIND is unset or loopback, which is the
      default). Nothing outside this machine can reach it, and inside a container
      a published port reaches nothing: whatever fronts this app has to share the
      network namespace. Set BOOKSCAN_BIND=all to listen on every interface
      instead.
```

```
[api] listening on http://0.0.0.0:3001
[api] bound to EVERY interface (BOOKSCAN_BIND=all). Anything that can route to
      this machine or container can reach it, and the sign-in gate is the only
      thing in front of the catalogue.
```

`EVERY` is shouted on purpose. A person scanning a start log for the reason
something is reachable should not have to compare two addresses character by
character to find out.

---

## Development is untouched, and that is checked rather than hoped

`apphost.mts` is not modified. Aspire sets what it sets, no AppHost or script in
this repository sets `BOOKSCAN_BIND`, and an unset variable is the same
`127.0.0.1` the api has always listened on, printed by the same first line of the
start log. The browser suite depends on those ports and none of them moved.

The Vite dev server is a separate process and is not affected either: it binds
every interface already, deliberately, so a phone can reach it at a bookshelf
(`AGENTS.md`, and Safari will not open a camera over plain HTTP). Nothing here
touches it.

---

## What was proved by running it

**A variable that decides what a socket does cannot be proved by a unit test.**
`web/server/bind.test.ts` covers the resolver and the two log lines and it proves
nothing about reachability, so the claim was driven against the image: one
Postgres 18 container, one network, and the same `book-scan:539` image run three
ways with a port published every time.

### The default, with the port published: the route exists and reaches nothing

```
$ docker run -d --name bs539-closed --network bs539 -p 55321:3001 \
    -e ConnectionStrings__bookscan=postgres://…@bs539-pg:5432/bookscan book-scan:539

[api] listening on http://127.0.0.1:3001
[api] bound to loopback only (BOOKSCAN_BIND is unset or loopback, which is the
default). Nothing outside this machine can reach it, and inside a container a
published port reaches nothing: whatever fronts this app has to share the network
namespace. Set BOOKSCAN_BIND=all to listen on every interface instead.
```

```
$ curl -sS -m 8 http://127.0.0.1:55321/
curl: (52) Empty reply from server        # http_code=000, curl exit 52
```

That is the failure the contract has warned about since #533, in the shape it
actually arrives in: not a refused connection, an accepted one that dies. Docker's
proxy takes the TCP connection on the host and finds nothing at the container's
address, so a deployer sees an empty reply from a container whose log says it is
listening.

It **is** listening, and both of these say so from inside the namespace:

```
$ docker exec bs539-closed node -e "fetch('http://127.0.0.1:3001/api/health')…"
inside the container, loopback -> 401

$ docker exec bs539-closed cat /proc/net/tcp
  sl  local_address rem_address   st …
   0: 0100007F:0BB9 00000000:0000 0A …
```

`0100007F:0BB9` is `127.0.0.1:3001`, state `0A`, which is LISTEN. The kernel's
own table is the least arguable form of "which interface".

### The same image with one variable: the published port is the app

```
$ docker run -d --name bs539-open --network bs539 -p 55321:3001 \
    -e ConnectionStrings__bookscan=… -e BOOKSCAN_BIND=all book-scan:539

[api] listening on http://0.0.0.0:3001
[api] bound to EVERY interface (BOOKSCAN_BIND=all). Anything that can route to
this machine or container can reach it, and the sign-in gate is the only thing in
front of the catalogue.

$ docker exec bs539-open cat /proc/net/tcp
   1: 00000000:0BB9 00000000:0000 0A …
```

```
GET http://127.0.0.1:55321/                  -> 200 text/html, 741 bytes
GET http://127.0.0.1:55321/api/health        -> 401 {"state":"anonymous","error":"Sign in to use this."}
GET http://127.0.0.1:55321/api/auth/session  -> 200 {"state":"anonymous"}
```

**Both halves of that matter.** The client is served from outside the container,
and `/api/health` answers `401` to a stranger, which is `docs/the-gate.md` doing
the thing this document has just made load-bearing.

And it is the whole app rather than a static directory, proved by signing in
through the published port on a container given the development door for the
purpose:

```
$ curl -i http://127.0.0.1:55321/api/auth/dev/start
HTTP/1.1 302 Found
Set-Cookie: bookscan_session=jgC5…HB8; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax

$ curl -H "Cookie: …" http://127.0.0.1:55321/api/auth/session
{"state":"admitted","user":{"id":"377a57d2-…","enabled":true,"email":"verifier@localhost",…}}

$ curl -H "Cookie: …" http://127.0.0.1:55321/api/health
{"ok":true,"counts":{…},"db":"postgres bs539-pg:5432/bookscan",…}   # 200
```

A request that entered on `0.0.0.0`, passed the gate, read Postgres and came
back. `docker stop --time 10` on that container returned in **0.47s, exit 0**,
with `[api] SIGTERM: closing the listener, then the catalogue` and `[api]
stopped`, so the signal handler is unaffected by which interface was bound.

### The refusal, met the way a deployer would meet it

```
$ docker run --rm -e ConnectionStrings__bookscan=… -e BOOKSCAN_BIND=0.0.0.0 book-scan:539
[otel] no OTEL_EXPORTER_OTLP_ENDPOINT, telemetry disabled
Error: BOOKSCAN_BIND is "0.0.0.0", which is not one of the two words it takes.

  loopback  127.0.0.1, and the default. …
  all       0.0.0.0, every interface in the namespace. …

It is a word rather than an address on purpose. …
    at bindFrom (/app/web/server/bind.ts:119:9)
    at <anonymous> (/app/web/server/index.ts:4442:16)

; exit=1
```

It exits before the database is opened and before anything listens, and the frame
names the source file rather than a line of the bundle, because the image runs
Node with `--enable-source-maps`.

The same value, caught earlier, by the checker that ships inside the image:

```
$ docker run --rm -e ConnectionStrings__bookscan=… -e BOOKSCAN_BIND=0.0.0.0 \
    book-scan:539 node /app/deploy/check-config.mjs

  WRONG    BOOKSCAN_BIND is "0.0.0.0", which is not loopback or all. It takes a
           word rather than an address, and network.bindNote in the contract
           beside this file says why. On a start with this set: …

1 thing to fix before this deploys.        # exit 1
```

and the open bind, which is not an error and is said back as the state it is:

```
$ docker run --rm -e ConnectionStrings__bookscan=… -e BOOKSCAN_BIND=all \
    book-scan:539 node /app/deploy/check-config.mjs

  note     BOOKSCAN_BIND is all, so the server listens on 0.0.0.0: every
           interface in its network namespace, rather than the default loopback.
           Anything that can route to this container reaches the sign-in gate,
           which is then the only thing in front of the catalogue. …

Nothing here will stop this deploying.     # exit 0
```

### And the suite, in the image that carries it

`npm test` in the `build` stage, against a Postgres container, which is the
arrangement `docs/the-image.md` set up for a worktree with no `node_modules`:

```
$ docker run --rm --network bs539 -e BOOKSCAN_TEST_DATABASE_URL=… \
    -v "$PWD/postgres-version.json:/app/postgres-version.json:ro" \
    -v "$PWD/e2e:/app/e2e:ro" book-scan:539build npm test

 Test Files  141 passed (141)
      Tests  2813 passed (2813)
```

(The two mounts are a property of the build context rather than of this change:
the context is `web/`, and `server/pgcontainer.ts` reads `postgres-version.json`
from the repository root while `src/styles.test.ts` reads `e2e/`. `docs/the-image.md`
recorded the second one and this run met the first.)

---

## What this does not do

1. **It does not open anything.** The default is what it was, and an image that
   shipped `BOOKSCAN_BIND` set would be an image that opened a listener nobody
   asked for, so the `Dockerfile` deliberately does not set it.
2. **It does not choose a host, and it does not decide which shape this
   deployment is.** Both are still open: a tunnel daemon or a proxy sharing the
   namespace with the bind closed, or the container's own network as the boundary
   with it open. What changed is that the second one is now expressible.
3. **It does not add TLS.** With the bind open, whatever routes to the container
   is still terminating TLS, the session cookie is still `Secure`, and a phone
   still will not open a camera outside a secure context.
4. **It does not narrow what `all` means.** There is no way to name one interface
   and there is deliberately not going to be one until a deployment needs it; see
   decision 2 for why an address is the wrong thing to accept from configuration
   inside a container.
5. **It does not make the gate optional to think about.** With `all` set, the
   gate is the only thing in front of the catalogue. `docs/the-gate.md` is what
   that rests on, and this document is not an argument that it is enough. It is
   an argument that the decision now belongs to the deployment rather than to a
   line of code in this repository.
