/**
 * The gate, and the five doors in front of it (#521).
 *
 * ## Where the gate is, and why one line covers everything
 *
 * `docs/auth-surface.md` counted seventy-two ways into this app and found that
 * every one of them is a route on one Express app, built by one factory, in one
 * file, with no middleware at all between the body parser and the handlers. So
 * there is exactly one place a check has to go, and `mountGate` is one
 * `app.use('/api', ...)` registered at that place.
 *
 * **Scoped to `/api` rather than to the whole app, and that is the design.**
 * Every hand-declared handler and the cover mount live under `/api`; the only
 * things that do not are the built client's own files and the single-page
 * fallback, which are the login screen and must be reachable by somebody who
 * cannot sign in yet. Scoping the mount this way means the open set is a
 * property of the path space rather than a list somebody maintains: a route
 * added anywhere under `/api`, at any point below the mount, is behind the gate
 * because of where it is, not because anybody remembered.
 *
 * **The photographs are the door most likely to be left open**, and this is what
 * covers them. `docs/auth-surface.md` measured `GET /api/covers/<name>` from
 * another machine on the network answering `200` with the image bytes and a
 * thirty day immutable cache header on it. Both cover doors — the thumbnail
 * route and the `express.static` mount — are under `/api/covers`, which is under
 * `/api`, which is behind this. `sign-in.routes.test.ts` proves it by asking.
 *
 * **That cache header outlived this check by three months** (#556). It said
 * `public`, which invites an intermediary to keep somebody's photographs, and
 * `immutable`, which told the browser not to ask again for thirty days — so
 * `enabled` being read here on every request, three paragraphs down, was not
 * true of the one thing this comment calls the door most likely to be left
 * open. See `COVER_CACHE` in `server/index.ts`.
 *
 * **And every JSON route said nothing at all**, which is not the same thing as
 * saying do not cache: a response carrying no freshness information is one a
 * shared cache may store and reuse under a heuristic of its own.
 * `mountCachePolicy` below answers that for the whole path space, above the
 * gate rather than below it so that the two refusals carry it too. See
 * `API_CACHE` (#566).
 *
 * ## The three states, and why both refusals are load-bearing
 *
 * | Who | What this answers |
 * | --- | --- |
 * | No session, or a dead one | `401`, body `state: "anonymous"` |
 * | A session whose user is not enabled | `403`, body `state: "waiting"` |
 * | A session whose user is enabled | `next()` |
 *
 * A client cannot choose between the login screen and the waiting-list screen
 * unless the server says which. Collapsing the two makes a person who is signed
 * in and simply not admitted look logged out, and sends them round the sign-in
 * loop for ever. See `shared/auth.ts`.
 *
 * ## There is no way to switch this off
 *
 * There is no option, no environment variable and no branch in `gate` that skips
 * the check. Development keeps working through `providers.ts`'s development
 * *provider*, which mints an ordinary session for an ordinary user row through
 * the same three steps Google's callback walks. That is the difference between a
 * configuration that seeds an identity and a configuration that opens a hole,
 * and the argument is written out on `devProvider`.
 */

import { createHash } from 'node:crypto'
import type express from 'express'

import {
  REFUSAL_STATUS, SESSION_COOKIE, SIGN_IN_FLOW_MINUTES, troubleUrl,
  type SessionAnswer, type SignInProvider, type SignInTrouble,
} from '../../shared/auth'
import type { AuthStore } from '../../infrastructure/auth/auth-store'
import { RENEW_AFTER_MINUTES, SESSION_DAYS } from '../../infrastructure/auth/auth-store'
import {
  authorizationUrl, exchange, opaque, pkce, SignInRefused,
} from './oidc'
import { resolveProvider } from './discovery'
import type { SignInConfig, SignInProviderConfig } from './providers'

/**
 * Where the gate is mounted. Everything under here is behind it.
 *
 * Exported because `gate.routes.test.ts` walks the router stack and counts what
 * is registered on either side of this mount, which is how the count in
 * `docs/the-gate.md` is kept honest rather than restated.
 */
export const GATE_MOUNT = '/api'

/**
 * What an answer from this API says may be done with it once it has left.
 *
 * The gate decides who may ask. This is the other half of the same question,
 * and #556 answered it for the photographs while every JSON route here still
 * said nothing at all: no `Cache-Control`, no `Expires`, no `Vary`, on
 * `/api/health`, on `/api/books`, on the `/api` catch-all 404 and on both of
 * the gate's own refusals.
 *
 * **"Nothing" is not "do not cache".** RFC 9111 §4.2.2 lets a cache with no
 * explicit expiration pick a heuristic lifetime of its own, and RFC 9110 §15.1's
 * list of heuristically cacheable statuses includes `404`. So the safety came
 * entirely from what somebody else's product happens to do by default. Two
 * things were doing it: JSON has no file extension, and these responses carry
 * no `Last-Modified` for a heuristic to work from. Neither is a property of
 * this application. `docs/running-from-a-build.md` decision 1 sanctions a
 * TLS-terminating proxy in front of this one origin and #471 puts a CDN there,
 * and a caching proxy in that position was entitled to store `/api/books`,
 * which is the collection, and hand it to somebody carrying no session.
 *
 * **`private`, for the reason the covers got it.** It is the only word that
 * speaks to an intermediary, and it costs a phone nothing.
 *
 * **`no-cache` rather than `no-store`, and the two are genuinely different.**
 * `no-store` forbids writing the response down at all; `no-cache` allows a
 * stored copy that may not be reused without revalidating against this server
 * first. Three things decided it:
 *
 * 1. **`no-cache` is the gate's own model, spelled as a cache directive.**
 *    `gate` below reads `enabled` off the `user` row on every request so that
 *    disabling somebody takes effect on their very next one, and `app/gate.tsx`
 *    stores no admission because a client that remembers being admitted will
 *    show the app to somebody who has just been disabled (#524). Under
 *    `no-cache` every *use* of a stored response is a request that meets this
 *    gate. That is the property #556 bought for the photographs with a five
 *    minute window; here it is exact, with no window at all.
 * 2. **It is the one that degrades well.** A shared cache that has been told to
 *    ignore `private` still may not serve a `no-cache` response without asking
 *    this origin, and the ask carries the requester's own cookie, so this
 *    server answers `401` and the stored copy is not served. A shared cache
 *    that has been told to ignore `no-store` has nothing left to make it ask.
 *    The issue's complaint is that the safety currently rests on somebody
 *    else's defaults; the directive that keeps this server the authority on
 *    every reuse is the one that answers it.
 * 3. **It costs a phone nothing, where `no-store` costs it the whole body
 *    every time.** Measured rather than assumed, against this server on a
 *    seeded catalogue of 27 books, asking `/api/books` three times in
 *    Chromium:
 *
 *    | what the answer said | first ask | second | third |
 *    | --- | --- | --- | --- |
 *    | nothing (the tree before this) | `200`, 24,754 bytes | `304`, 180 | `304`, 180 |
 *    | `private, no-cache` | `200`, 24,788 bytes | `304`, 214 | `304`, 214 |
 *    | `private, no-store` | `200`, 24,788 bytes | `200`, 24,788 | `200`, 24,788 |
 *
 *    So `no-cache` is not a saving. It is parity with what the browser was
 *    already doing on its own, now said rather than guessed, and `no-store` is
 *    the row that pays. That listing scales with the collection, and this is a
 *    phone-first app on somebody's mobile data.
 *
 * **What `no-store` would have cost, said plainly**, because it is the option
 * a reader will reach for. It is the third row above, and it is *not* the
 * browser's back/forward cache: `no-store` blocks that when it is on a
 * *document*, and nothing under `/api` is a document. The document this app
 * loads is `index.html`, which is outside `/api` and already says `no-cache`
 * at the bottom of `server/index.ts`. What `no-store` would buy for that price
 * is only that the bytes are not written to the browser's own cache directory,
 * a residue this app already accepts for the photographs, which are the larger
 * disclosure of the two.
 *
 * **No `max-age`, and that is a decision rather than an omission.** The covers
 * take a five minute window because a placement card draws twenty-five
 * neighbour spines per scan and the same photograph is asked for over and over
 * within one run. Nothing here is shaped like that: a listing is fetched once
 * per screen, it is small, and it changes the moment somebody scans a book,
 * which is the workflow. A window that helps the photographs would show
 * somebody the catalogue as it was before the book they just shelved.
 *
 * **No `must-revalidate` either.** It governs what a cache may do with a
 * *stale* stored response, and under `no-cache` there is no such state: nothing
 * may be reused without validating, full stop, so adding it would be
 * decoration. The covers carry it because they carry a `max-age` for it to
 * bite on.
 *
 * **And no `Vary: Cookie`**, rejected for the same two reasons #556 rejected it
 * on `COVER_CACHE`: under `private` it buys nothing against the party it would
 * be aimed at, and the browser's own cache honours it too, so a fresh sign-in
 * would throw away every stored copy, `admit()` minting a new token each time.
 * It is not needed for correctness here either: revalidation is what keeps a
 * stored response honest, and this app holds one catalogue rather than a
 * per-person view of it.
 *
 * **One string for the whole path space, including the five open doors.** They
 * are the ones whose answers are most obviously not somebody else's to keep: a
 * sign-in redirect carries a `state` and a nonce, and `GET /api/auth/session`
 * is a response about a person, naming their email.
 */
export const API_CACHE = 'private, no-cache'

/**
 * Say it once, above everything else under `/api`.
 *
 * There are seventy-odd handlers and two cover doors, and a policy applied by
 * hand at each is a policy that will be missing from the next one, which is
 * the exact defect #556 found three months after the header was written. This is
 * mounted on the same path as the gate and immediately above it, so being
 * covered is a property of where a route is rather than of anybody having
 * remembered, which is the property `mountGate` was built for and the reason
 * this is a second `app.use(GATE_MOUNT, ...)` and not a line in each handler.
 *
 * **It sets a default rather than the last word.** A route with a considered
 * answer of its own overwrites this one on the way out, and one does:
 * `COVER_CACHE` in `server/index.ts`, at both cover doors, which #556 argued
 * out and which must not be quietly replaced by a broader rule sitting
 * upstream of it. `server/index.test.ts` asserts both strings, at all four
 * doors, so the two cannot part company without the suite going red.
 *
 * **Above the gate rather than below it**, so the two refusals carry it as well
 * as the routes. A stored `401` served later to somebody who has since been
 * admitted is the same class of defect from the other side.
 *
 * Named rather than anonymous for the same reason `gate` is: Express records
 * the function name on the layer, and `gate.routes.test.ts` asserts by name
 * exactly what is allowed to sit above the gate.
 */
export function mountCachePolicy(app: express.Express): void {
  app.use(GATE_MOUNT, function apiCache(_req, res, next) {
    res.setHeader('Cache-Control', API_CACHE)
    next()
  })
}

/**
 * The cookie carrying the state of a sign-in that has gone out and not come
 * back. See `sign_in_flow` in `infrastructure/db/schema.ts`.
 */
const FLOW_COOKIE = 'bookscan_signin'

/** Thirty days, in seconds, for `Max-Age`. */
const SESSION_MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

/**
 * Exactly as long as the `sign_in_flow` row lives, from the one number.
 *
 * It has to be the same number rather than merely a similar one. If the cookie
 * outlived the row, a sign-in left too long would arrive with a matching cookie
 * and no row and be told it had already been used, which is a sentence about
 * something nobody did. See `SIGN_IN_FLOW_MINUTES`.
 */
const FLOW_MAX_AGE_MS = SIGN_IN_FLOW_MINUTES * 60 * 1000

/**
 * How a cookie is set here, in one place, so no door can spell it differently.
 *
 * - `httpOnly`, so the client's own JavaScript cannot read it and neither can
 *   anything injected into the page.
 * - `sameSite: 'lax'`, which is what stands between the twenty-four `POST`
 *   handlers this app has and a cross-site forgery. Until #521 there was nothing
 *   to forge because there was no credential; now there is one, and `lax` means
 *   a form on somebody else's page cannot make a request that carries it. `lax`
 *   rather than `strict` because the OpenID Connect callback is a top-level
 *   navigation arriving from the provider's origin, and `strict` would drop the
 *   cookie exactly there.
 * - `secure`, per #521. Browsers treat `http://localhost` as a secure context
 *   and will store a `Secure` cookie set over it, so this does not break a
 *   development checkout; the dev server speaks HTTPS anyway.
 * - `path: '/'`, because the client, the API and the photographs are one origin
 *   since #520 and the cookie has to reach all three.
 */
function cookieOptions(maxAgeMs: number): express.CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: maxAgeMs,
  }
}

/**
 * One cookie out of a request, without a dependency.
 *
 * `cookie-parser` is a package and a middleware for what is a `split` and a
 * `decodeURIComponent`, and `docs/auth-surface.md` recorded that this app has no
 * middleware from a library at all. Reading one value by name keeps it that way.
 */
export function cookieFrom(header: string | undefined, name: string): string {
  if (!header) return ''
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=')
    if (at < 0) continue
    if (pair.slice(0, at).trim() !== name) continue
    try {
      return decodeURIComponent(pair.slice(at + 1).trim())
    } catch {
      // A value that is not valid percent-encoding is not a cookie this server
      // wrote, so it addresses nothing and answering "no cookie" is correct.
      return ''
    }
  }
  return ''
}

/** The digest a session row is keyed by. Never the cookie value itself. */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Where a sign-in may send the browser afterwards.
 *
 * A path on this origin, beginning with exactly one `/`. Anything else is
 * refused down to `/`, because a redirect target taken out of a query string is
 * an open redirect: `?next=https://elsewhere` would make this app's own sign-in
 * the thing that lands somebody on a page they did not ask for, with this app's
 * name in the address bar on the way.
 *
 * `//host` and `/\host` are both refused explicitly. Browsers read the first as
 * a protocol-relative URL and some read the second the same way, and both start
 * with a `/`, so a naive check passes them.
 */
export function safeNext(asked: unknown): string {
  if (typeof asked !== 'string' || !asked.startsWith('/')) return '/'
  if (asked.startsWith('//') || asked.startsWith('/\\')) return '/'
  return asked
}

/** What the routes and the gate need to do their work. */
export interface SignInDeps {
  store: AuthStore
  config: SignInConfig
  /** Injected so a test can drive an expiry without waiting for one. */
  now?: () => Date
}

/**
 * The five doors that are open, and the whole of the argument for each.
 *
 * Worked out rather than taken from a list, per #521, and the reasoning is the
 * same three questions the issue asks: what serves a login, what a provider
 * redirects back to, and what tells the client which of the three states it is
 * in.
 *
 * 1. **`GET /api/auth/providers`** — which buttons to draw. A caller with no
 *    session has to be able to ask, or there is no login screen. It discloses
 *    that this app can be signed into with Google, which is what the button
 *    says.
 * 2. **`GET /api/auth/session`** — which of the three states the caller is in.
 *    This is the one the issue names, and it is open rather than gated because
 *    it must answer in the `anonymous` state as well as the other two. It
 *    discloses nothing to a stranger: `{"state":"anonymous"}`.
 * 3. **`GET /api/auth/:provider/start`** — the login itself. Open by necessity:
 *    nobody has a session before it.
 * 4. **`GET /api/auth/:provider/callback`** — where the provider redirects back
 *    to. Open by necessity, and the reason the redirect URI has to be an
 *    absolute URL registered with the provider.
 * 5. **`POST /api/auth/signout`** — open, and this one is a judgement rather
 *    than a necessity. A person on the waiting-list screen has a session and is
 *    refused `403` everywhere; if signing out were behind the gate they could
 *    not sign out, which is the one thing that screen has to offer somebody who
 *    picked the wrong Google account. It destroys only the session in the
 *    caller's own cookie, and a caller with no cookie destroys nothing.
 *
 * **Everything else is behind the gate, including `/api/covers` and including
 * `/api/health`.** See `docs/the-gate.md` for the count and for the health
 * endpoint's reasoning.
 */
export const OPEN_DOORS = [
  'GET /api/auth/providers',
  'GET /api/auth/session',
  'GET /api/auth/:provider/start',
  'GET /api/auth/:provider/callback',
  'POST /api/auth/signout',
] as const

/**
 * Register the five open doors.
 *
 * Called from `createApp` immediately before `mountGate`, and the order is the
 * design: what is registered above the gate is open and what is registered below
 * it is not, so the open set is five lines somebody can read rather than a
 * predicate somebody has to evaluate. `gate.routes.test.ts` asserts exactly that
 * by walking the router stack.
 */
export function mountSignIn(app: express.Express, deps: SignInDeps): void {
  const clock = deps.now ?? (() => new Date())
  const byId = (id: string): SignInProviderConfig | undefined =>
    deps.config.providers.find((one) => one.id === id)

  const redirectUri = (provider: SignInProviderConfig): string =>
    `${deps.config.publicOrigin}/api/auth/${provider.id}/callback`

  /**
   * Send the browser back to the login screen, saying which of the six this was.
   *
   * **The two routes below are the only ones in this app whose answer a browser
   * renders as a page**, because a provider redirect and a pressed sign-in
   * button are top-level navigations rather than requests `lib/api.ts` makes. So
   * a JSON body here is not an API answer that a client will read and act on: it
   * is the whole page, with no link, no button and no way back but the address
   * bar. #557 found every one of the eleven exits below doing exactly that.
   *
   * So every refusal either of them makes comes through here. That is a rule
   * about these two routes rather than a fix applied to the branches somebody
   * happened to notice, so an exit added under them next year cannot
   * reintroduce the defect by being forgotten: there is nothing here for it to
   * copy that would render.
   *
   * **An exception is not one of these and is deliberately left alone.** Both
   * handlers end in `.catch(next)`, and a throw that reaches it is a defect in
   * this server rather than a way a sign-in can fail. Redirecting a person past
   * one would hide it and tell them something untrue at the same time, which is
   * the `inTheBackground` argument in `AGENTS.md` about nets that log and carry
   * on.
   *
   * The reason travels as a code and the provider as its id, and neither is ever
   * rendered: `shared/auth.ts` says why, and it is the difference between a
   * screen that says one of six sentences and a screen that reads a stranger's
   * text out loud.
   */
  function sendBack(
    res: express.Response,
    trouble: SignInTrouble,
    provider?: SignInProviderConfig,
  ): void {
    res.redirect(302, troubleUrl(trouble, provider?.id))
  }

  app.get('/api/auth/providers', (_req, res) => {
    const providers: SignInProvider[] = deps.config.providers.map((one) => ({
      id: one.id,
      label: one.label,
      start: `/api/auth/${one.id}/start`,
    }))
    res.json({ providers })
  })

  app.get('/api/auth/session', (req, res, next) => {
    void (async () => {
      const answer = await describe(deps, req, clock())
      res.json(answer)
    })().catch(next)
  })

  app.get('/api/auth/:provider/start', (req, res, next) => {
    void (async () => {
      const provider = byId(String(req.params.provider))
      /*
       * A stale bookmark, a hand-typed path, or a button drawn from a provider
       * list this server has since stopped carrying. Whichever it was, somebody
       * is looking at the answer, so it is the login screen and not a 404 body.
       */
      if (!provider) {
        sendBack(res, 'no-such-way')
        return
      }
      const next_ = safeNext(req.query.next)

      /*
       * The development door signs in here and now, with no provider asked.
       * It is the same three steps the callback below takes — find or create,
       * open a session, set the cookie — reached without a round trip, because
       * there is nobody to make the round trip to.
       */
      if (provider.kind === 'trusted') {
        await admit(deps, res, provider, {
          subject: provider.subject,
          email: `${provider.subject}@localhost`,
          name: provider.subject,
        }, clock())
        res.redirect(302, next_)
        return
      }

      /*
       * Where the browser is sent may not be knowable from the row (#537). A
       * provider carrying a `discovery` URL has its endpoints read out of the
       * authority's own document here, cached for the process; one carrying an
       * issuer resolves to itself and touches nothing.
       */
      const settled = await settle(provider)
      if ('trouble' in settled) {
        sendBack(res, settled.trouble, provider)
        return
      }
      const resolved = settled.provider

      const state = opaque()
      const nonce = opaque()
      const { verifier, challenge } = pkce()
      await deps.store.openFlow(
        { state, provider: provider.id, codeVerifier: verifier, nonce, next: next_ },
        clock(),
      )
      // The browser gets the state too, so the callback can require that the
      // browser completing the flow is the browser that started it.
      res.cookie(FLOW_COOKIE, state, cookieOptions(FLOW_MAX_AGE_MS))
      res.redirect(302, authorizationUrl(resolved, {
        redirectUri: redirectUri(resolved), state, nonce, challenge,
      }))
    })().catch(next)
  })

  app.get('/api/auth/:provider/callback', (req, res, next) => {
    void (async () => {
      const provider = byId(String(req.params.provider))
      if (!provider || provider.kind !== 'oidc') {
        sendBack(res, 'no-such-way')
        return
      }

      const now = clock()
      res.clearCookie(FLOW_COOKIE, { path: '/' })

      /*
       * The provider said no, and this is the ordinary case rather than an
       * exception: somebody pressed cancel. Its own words are not repeated,
       * because they are somebody else's text arriving in a query string.
       *
       * **`access_denied` is told apart from the rest and it is the whole of
       * why this parameter is read at all** (#557). OAuth 2.0 §4.1.2.1 gives it
       * one meaning, which is that the person or their provider did not grant
       * this, and in practice that is somebody pressing Cancel. Every other code
       * in that list — `server_error`, `invalid_client`, `unauthorized_client`,
       * `invalid_scope` — is a fault on one side or the other that the person
       * cannot do anything about. Telling somebody who pressed Cancel that
       * something is misconfigured, or telling somebody whose sign-in is broken
       * that they cancelled, are both this app saying something untrue about
       * them, and it costs one comparison not to.
       */
      if (typeof req.query.error === 'string') {
        sendBack(res, req.query.error === 'access_denied' ? 'cancelled' : 'refused', provider)
        return
      }

      const state = typeof req.query.state === 'string' ? req.query.state : ''
      const carried = cookieFrom(req.headers.cookie, FLOW_COOKIE)
      if (!state || state !== carried) {
        /*
         * Either half missing is the same answer. A state with no cookie behind
         * it is a callback arriving in a browser that did not start the flow,
         * which is a login CSRF; a cookie with no state is a stray request.
         *
         * **It is also where the ordinary ones land**, which was worth finding
         * out: pressing Back after signing in, opening the callback link a
         * second time, and taking longer than `FLOW_MINUTES` over the provider
         * all arrive here rather than at the exit below, because the flow cookie
         * is cleared by the callback that spends it and lives exactly as long as
         * the row does. So this refusal is mostly innocent people, and the words
         * `stale` chooses are written for them rather than for the attack.
         */
        sendBack(res, 'stale', provider)
        return
      }

      const flow = await deps.store.takeFlow(state, now)
      if (!flow || flow.provider !== provider.id) {
        sendBack(res, 'already-used', provider)
        return
      }

      const code = typeof req.query.code === 'string' ? req.query.code : ''
      if (!code) {
        // Neither an error nor a code, which is not a shape the specification
        // allows a redirect back to have. Nothing was granted and nothing was
        // refused, so it goes with the other things the provider got wrong.
        sendBack(res, 'refused', provider)
        return
      }

      /*
       * Resolved again, and this is where it matters most: what comes back is
       * the token endpoint this server posts its client secret to, and the
       * issuer the ID token is then checked against. For a discovered provider
       * both come from the authority's document rather than from anything
       * written here, which is the whole of #537.
       */
      const settled = await settle(provider)
      if ('trouble' in settled) {
        sendBack(res, settled.trouble, provider)
        return
      }
      const resolved = settled.provider

      let identity
      try {
        identity = await exchange(
          resolved,
          { code, redirectUri: redirectUri(resolved), verifier: flow.code_verifier },
          now,
        )
      } catch (error) {
        if (!(error instanceof SignInRefused)) throw error
        /*
         * The log keeps the exact message and the person gets one of six
         * sentences. That split is deliberate: these messages name this
         * server's checks — an issuer, an audience, a claim that would not
         * parse — and a person who wants to look at some books can do nothing
         * with any of them. Whoever runs this app can, and the log is where
         * they are.
         */
        console.warn('[auth] sign-in refused:', error.message)
        sendBack(res, error.trouble, provider)
        return
      }

      if (identity.nonce !== flow.nonce) {
        // The token is real and belongs to some other authorization request of
        // this client's, which is a token this server will not accept however
        // many times it arrives.
        sendBack(res, 'refused', provider)
        return
      }

      // `resolved`, not `provider`, because the issuer half of the identity's
      // key is the discovered one for a discovered provider.
      await admit(deps, res, resolved, identity, now)
      res.redirect(302, flow.next)
    })().catch(next)
  })

  app.post('/api/auth/signout', (req, res, next) => {
    void (async () => {
      const token = cookieFrom(req.headers.cookie, SESSION_COOKIE)
      if (token) await deps.store.revokeSession(hash(token), clock())
      // Cleared whether or not there was anything to revoke, so a cookie
      // addressing a session that has already gone does not keep coming back.
      res.clearCookie(SESSION_COOKIE, { path: '/' })
      res.status(204).end()
    })().catch(next)
  })
}

/**
 * A provider with its issuer and endpoints on it, or which of the six this was.
 *
 * **`unavailable` and not `refused`**, which is the same distinction this used
 * to draw as `502` and not `400`, said in the vocabulary a person is told in
 * (#557): a token this server refuses is a bad sign-in and is the caller's
 * business, while an authority that will not say what its issuer is has nothing
 * to do with whoever pressed the button. Telling them their sign-in was refused
 * would be telling them something was wrong with it when the truth is that this
 * app cannot currently sign anybody in through that door.
 *
 * Refusing rather than falling back is the point. There is no "carry on without
 * the issuer" branch, because carrying on without the issuer is the defect #537
 * exists to prevent.
 *
 * It answers rather than writing to the response, so the one place a browser is
 * sent back from is `sendBack` and there is no second spelling of the redirect
 * for somebody to get subtly different.
 */
type Settled =
  | { provider: SignInProviderConfig }
  | { trouble: SignInTrouble }

async function settle(provider: SignInProviderConfig): Promise<Settled> {
  try {
    return { provider: await resolveProvider(provider) }
  } catch (error) {
    if (!(error instanceof SignInRefused)) throw error
    console.warn('[auth] provider could not be resolved:', error.message)
    return { trouble: error.trouble }
  }
}

/**
 * Find or create the person, open a session, hand over the cookie.
 *
 * The one place a session is ever created, walked by every provider. A
 * `trusted` provider reaches it without a round trip and an `oidc` one reaches
 * it with a verified ID token in hand, and from here on the two are the same
 * row.
 */
async function admit(
  deps: SignInDeps,
  res: express.Response,
  provider: SignInProviderConfig,
  identity: { subject: string; email: string; name: string },
  now: Date,
): Promise<void> {
  const person = await deps.store.findOrCreate(
    { issuer: provider.issuer, subject: identity.subject, email: identity.email, name: identity.name },
    now,
  )

  /*
   * The development door, and only it, opens the door as well as the identity.
   * Every real provider leaves `enabled` where the schema put it, which is
   * false, so a first sign-in through Google produces somebody on the waiting
   * list and nothing else. See `devProvider`.
   */
  if (provider.admitsOnSight && !person.enabled) {
    await deps.store.setEnabled(person.id, true, now)
  }

  const token = opaque()
  await deps.store.openSession(hash(token), person.id, now)
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_MS))
}

/** Which of the three states this request is in, and who it is if it is anybody. */
async function describe(
  deps: SignInDeps,
  req: express.Request,
  now: Date,
): Promise<SessionAnswer> {
  const token = cookieFrom(req.headers.cookie, SESSION_COOKIE)
  if (!token) return { state: 'anonymous' }

  const live = await deps.store.liveSession(hash(token), now)
  if (!live) return { state: 'anonymous' }

  const identity = await deps.store.latestIdentity(live.user_id)
  return {
    state: live.enabled ? 'admitted' : 'waiting',
    user: {
      id: live.user_id,
      enabled: live.enabled,
      email: identity?.email ?? '',
      name: identity?.name ?? '',
    },
  }
}

/**
 * Mount the gate. One line in `createApp`, and everything registered under
 * `/api` after it is behind it.
 */
export function mountGate(app: express.Express, deps: SignInDeps): void {
  const clock = deps.now ?? (() => new Date())

  /*
   * Named rather than anonymous, and the name is load-bearing. Express records a
   * middleware's function name on the layer it makes, so `gate.routes.test.ts`
   * can find this one in the router stack and count what is registered on either
   * side of it. That count is how "everything is behind the gate" stays a
   * measurement rather than a claim.
   */
  app.use(GATE_MOUNT, function gate(req, res, next) {
    void (async () => {
      const token = cookieFrom(req.headers.cookie, SESSION_COOKIE)
      if (!token) return refuse(res, 'anonymous')

      const digest = hash(token)
      const live = await deps.store.liveSession(digest, clock())
      if (!live) {
        // A cookie addressing a session that has been revoked or has expired is
        // the same answer as no cookie: this server does not know who you are.
        // It is cleared on the way past so the browser stops sending it.
        res.clearCookie(SESSION_COOKIE, { path: '/' })
        return refuse(res, 'anonymous')
      }

      /*
       * `enabled` is read from `user` on this request rather than cached on the
       * session, so disabling somebody takes effect on their very next request
       * rather than whenever their session happens to expire. That is what lets
       * the enable script be a script: it writes one column and does not have to
       * go hunting for sessions.
       */
      if (!live.enabled) return refuse(res, 'waiting')

      /*
       * Renewed on use, and only when it has gone stale. A phone at a bookshelf
       * that asks for a sign-in every visit gets abandoned; a gate that writes a
       * row per request is a gate that costs more than the route behind it.
       * `renewSession` carries the staleness test in its own `WHERE`, so two
       * requests arriving together cannot both decide to write.
       */
      const staleFrom = new Date(clock().getTime() - RENEW_AFTER_MINUTES * 60_000)
      if (live.last_used_at < staleFrom.toISOString()) {
        await deps.store.renewSession(digest, clock())
      }

      /*
       * Who is asking, carried the one way this app carries it.
       *
       * `docs/auth-surface.md` found there was no request context of any kind
       * here, and this is the whole of the one it now has: the local user id,
       * on `res.locals`, written once. **The provider's subject is deliberately
       * not here**, and neither is anything shaped like a permission: what a
       * handler may need to know is which person is asking, and #171 has not
       * decided anything beyond that.
       */
      res.locals.userId = live.user_id
      next()
    })().catch(next)
  })
}

/** One of the two refusals, said the same way every time. */
function refuse(res: express.Response, state: 'anonymous' | 'waiting'): void {
  res.status(REFUSAL_STATUS[state]).json({
    state,
    error: state === 'anonymous'
      ? 'Sign in to use this.'
      : 'This account is signed in but has not been let in yet.',
  })
}
