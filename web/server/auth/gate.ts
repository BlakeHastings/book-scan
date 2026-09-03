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
  REFUSAL_STATUS, SESSION_COOKIE,
  type SessionAnswer, type SignInProvider,
} from '../../shared/auth'
import type { AuthStore } from '../../infrastructure/auth/auth-store'
import { RENEW_AFTER_MINUTES, SESSION_DAYS } from '../../infrastructure/auth/auth-store'
import {
  authorizationUrl, exchange, opaque, pkce, SignInRefused,
} from './oidc'
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
 * The cookie carrying the state of a sign-in that has gone out and not come
 * back. See `sign_in_flow` in `infrastructure/db/schema.ts`.
 */
const FLOW_COOKIE = 'bookscan_signin'

/** Thirty days, in seconds, for `Max-Age`. */
const SESSION_MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

/** Ten minutes. Longer than a sign-in takes and shorter than a coffee. */
const FLOW_MAX_AGE_MS = 10 * 60 * 1000

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
      if (!provider) {
        res.status(404).json({ error: 'There is no such way to sign in.' })
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
      res.redirect(302, authorizationUrl(provider, {
        redirectUri: redirectUri(provider), state, nonce, challenge,
      }))
    })().catch(next)
  })

  app.get('/api/auth/:provider/callback', (req, res, next) => {
    void (async () => {
      const provider = byId(String(req.params.provider))
      if (!provider || provider.kind !== 'oidc') {
        res.status(404).json({ error: 'There is no such way to sign in.' })
        return
      }

      const now = clock()
      res.clearCookie(FLOW_COOKIE, { path: '/' })

      /*
       * The provider said no, and this is the ordinary case rather than an
       * exception: somebody pressed cancel. Its own words are not repeated,
       * because they are somebody else's text arriving in a query string.
       */
      if (typeof req.query.error === 'string') {
        res.status(400).json({ error: `${provider.label} did not complete the sign-in.` })
        return
      }

      const state = typeof req.query.state === 'string' ? req.query.state : ''
      const carried = cookieFrom(req.headers.cookie, FLOW_COOKIE)
      if (!state || state !== carried) {
        // Either half missing is the same answer. A state with no cookie behind
        // it is a callback arriving in a browser that did not start the flow,
        // which is a login CSRF; a cookie with no state is a stray request.
        res.status(400).json({ error: 'That sign-in did not start here. Try again.' })
        return
      }

      const flow = await deps.store.takeFlow(state, now)
      if (!flow || flow.provider !== provider.id) {
        res.status(400).json({ error: 'That sign-in has expired or was already used.' })
        return
      }

      const code = typeof req.query.code === 'string' ? req.query.code : ''
      if (!code) {
        res.status(400).json({ error: `${provider.label} did not send an authorization code.` })
        return
      }

      let identity
      try {
        identity = await exchange(
          provider,
          { code, redirectUri: redirectUri(provider), verifier: flow.code_verifier },
          now,
        )
      } catch (error) {
        if (!(error instanceof SignInRefused)) throw error
        console.warn('[auth] sign-in refused:', error.message)
        res.status(400).json({ error: error.message })
        return
      }

      if (identity.nonce !== flow.nonce) {
        res.status(400).json({ error: 'That sign-in did not match the one that started.' })
        return
      }

      await admit(deps, res, provider, identity, now)
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

  app.use(GATE_MOUNT, (req, res, next) => {
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
