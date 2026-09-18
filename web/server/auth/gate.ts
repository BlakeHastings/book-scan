/**
 * The gate, mounted once on `/api`.
 *
 * Scoped to `/api` rather than to the whole app, so a route added anywhere
 * below the mount is behind the gate because of where it is. The only things
 * outside it are the built client's own files and the single-page fallback,
 * which are the login screen and must be reachable by somebody who cannot sign
 * in yet. Both cover doors are under `/api/covers`, so the photographs are
 * behind this too.
 *
 * The two refusals are distinct on purpose: no session or a dead one answers
 * `401` with `state: "anonymous"`, and a session whose user is not enabled
 * answers `403` with `state: "waiting"`. Collapsing them makes a person who is
 * signed in and simply not admitted look logged out, and sends them round the
 * sign-in loop for ever. See `shared/auth.ts`.
 *
 * Nothing switches the check off. Development signs in through `providers.ts`'s
 * `trusted` provider, which mints an ordinary session for an ordinary user row
 * through the same steps Google's callback walks. See docs/the-gate.md.
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

export const GATE_MOUNT = '/api'

/**
 * `Cache-Control` for every answer under `/api`.
 *
 * `private` because it is the only word that speaks to an intermediary, and a
 * caching proxy in front of this origin would otherwise be entitled to store
 * `/api/books` and hand it to somebody carrying no session. Saying nothing is
 * not saying do not cache: RFC 9111 section 4.2.2 lets a cache with no explicit
 * expiration pick a heuristic lifetime of its own, and RFC 9110 section 15.1
 * makes `404` heuristically cacheable.
 *
 * `no-cache` rather than `no-store`, which are genuinely different: `no-store`
 * forbids writing the response down at all, while `no-cache` allows a stored
 * copy that may not be reused without revalidating against this server first.
 * So every use of a stored response is a request that meets this gate, which is
 * what makes disabling somebody take effect at once. `no-store` would buy only
 * that the bytes are not written to the browser's cache directory, and it costs
 * the whole body on every request.
 *
 * No `max-age`, because a listing changes the moment somebody scans a book. No
 * `must-revalidate`, which governs what a cache may do with a stale stored
 * response, and under `no-cache` there is no such state.
 */
export const API_CACHE = 'private, no-cache'

/**
 * Mounted on the same path as the gate and immediately above it, so the two
 * refusals carry the header as well as the routes: a stored `401` served later
 * to somebody who has since been admitted is the same defect from the other
 * side.
 *
 * A default rather than the last word. A route with a considered answer of its
 * own overwrites this one on the way out, as `COVER_CACHE` in `server/index.ts`
 * does at both cover doors, so this must not be replaced by a broader rule
 * sitting upstream of it. Named rather than anonymous for the same reason `gate`
 * is.
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

const SESSION_MAX_AGE_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

/**
 * Exactly as long as the `sign_in_flow` row lives, from the one number. A
 * cookie that outlived the row would make a sign-in left too long arrive with a
 * matching cookie and no row, and be told it had already been used.
 */
const FLOW_MAX_AGE_MS = SIGN_IN_FLOW_MINUTES * 60 * 1000

/**
 * How a cookie is set here, in one place, so no door can spell it differently.
 *
 * - `httpOnly`, so the client's own JavaScript cannot read it and neither can
 *   anything injected into the page.
 * - `sameSite: 'lax'`, which is what stands between this app's `POST` handlers
 *   and a cross-site forgery: a form on somebody else's page cannot make a
 *   request that carries the cookie. `lax` rather than `strict` because the
 *   OpenID Connect callback is a top-level navigation arriving from the
 *   provider's origin, and `strict` would drop the cookie exactly there.
 * - `secure`. Browsers treat `http://localhost` as a secure context and will
 *   store a `Secure` cookie set over it, so this does not break a development
 *   checkout.
 * - `path: '/'`, because the client, the API and the photographs are one origin
 *   and the cookie has to reach all three.
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
      // wrote, so answering "no cookie" is correct.
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
 * Where a sign-in may send the browser afterwards: a path on this origin,
 * beginning with exactly one `/`. Anything else is refused down to `/`, because
 * a redirect target taken out of a query string is an open redirect.
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

export interface SignInDeps {
  store: AuthStore
  config: SignInConfig
  /** Injected so a test can drive an expiry without waiting for one. */
  now?: () => Date
}

/**
 * The five doors that are open, and why each one is.
 *
 * 1. `GET /api/auth/providers`, which buttons to draw. A caller with no session
 *    has to be able to ask, or there is no login screen. It discloses that this
 *    app can be signed into with Google, which is what the button says.
 * 2. `GET /api/auth/session`, which of the three states the caller is in. It
 *    must answer in the `anonymous` state as well as the other two, and it
 *    discloses nothing to a stranger: `{"state":"anonymous"}`.
 * 3. `GET /api/auth/:provider/start`, the login itself. Nobody has a session
 *    before it.
 * 4. `GET /api/auth/:provider/callback`, where the provider redirects back to.
 * 5. `POST /api/auth/signout`, a judgement rather than a necessity. A person on
 *    the waiting-list screen has a session and is refused `403` everywhere, so
 *    behind the gate they could not sign out, which is the one thing that
 *    screen has to offer somebody who picked the wrong Google account. It
 *    destroys only the session in the caller's own cookie.
 *
 * Everything else is behind the gate, including `/api/covers` and `/api/health`.
 * See docs/the-gate.md.
 */
export const OPEN_DOORS = [
  'GET /api/auth/providers',
  'GET /api/auth/session',
  'GET /api/auth/:provider/start',
  'GET /api/auth/:provider/callback',
  'POST /api/auth/signout',
] as const

/**
 * Register the five open doors. Called from `createApp` immediately before
 * `mountGate`, and the order is load-bearing: what is registered above the gate
 * is open and what is registered below it is not.
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
   * The two routes below are the only ones in this app whose answer a browser
   * renders as a page, because a provider redirect and a pressed sign-in button
   * are top-level navigations rather than requests `lib/api.ts` makes. A JSON
   * body from either is the whole page, with no link, no button and no way back
   * but the address bar, so every refusal they make comes through here.
   *
   * An exception is not one of these and is deliberately left alone: both
   * handlers end in `.catch(next)`, and a throw that reaches it is a defect in
   * this server rather than a way a sign-in can fail.
   *
   * The reason travels as a code and the provider as its id, and neither is ever
   * rendered. See `shared/auth.ts`.
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
       * Somebody is looking at this answer, so it is the login screen and not a
       * 404 body.
       */
      if (!provider) {
        sendBack(res, 'no-such-way')
        return
      }
      const next_ = safeNext(req.query.next)

      /*
       * The development door signs in here and now, with no provider asked,
       * because there is nobody to make the round trip to. Otherwise it is the
       * same `admit` the callback below reaches.
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
       * Where the browser is sent may not be knowable from the row. A provider
       * carrying a `discovery` URL has its endpoints read out of the authority's
       * own document here, cached for the process; one carrying an issuer
       * resolves to itself and touches nothing.
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
       * OAuth 2.0 section 4.1.2.1 gives `access_denied` one meaning, that the
       * person or their provider did not grant this. Every other code in that
       * list is a fault on one side or the other that the person cannot do
       * anything about, which is why the two are told apart.
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
         * The ordinary ones land here too, because the flow cookie is cleared by
         * the callback that spends it: pressing Back after signing in, opening
         * the callback link a second time, and taking too long over the provider
         * all arrive here rather than at the exit below, so `stale` is worded
         * for innocent people rather than for the attack.
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
        // allows a redirect back to have.
        sendBack(res, 'refused', provider)
        return
      }

      /*
       * Resolved again, and this is where it matters most: what comes back is
       * the token endpoint this server posts its client secret to, and the
       * issuer the ID token is then checked against. For a discovered provider
       * both come from the authority's document rather than from anything
       * written here.
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
         * sentences. These messages name this server's checks (an issuer, an
         * audience, a claim that would not parse), which a person who wants to
         * look at some books can do nothing with.
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
 * `unavailable` and not `refused`: a token this server refuses is a bad sign-in
 * and is the caller's business, while an authority that will not say what its
 * issuer is has nothing to do with whoever pressed the button. There is no
 * carry-on-without-the-issuer branch.
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
 * Find or create the person, open a session, hand over the cookie. The one
 * place a session is ever created, walked by every provider.
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
   * list and nothing else.
   */
  if (provider.admitsOnSight && !person.enabled) {
    await deps.store.setEnabled(person.id, true, now)
  }

  const token = opaque()
  await deps.store.openSession(hash(token), person.id, now)
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_MS))
}

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

/** Everything registered under `/api` after this call is behind the gate. */
export function mountGate(app: express.Express, deps: SignInDeps): void {
  const clock = deps.now ?? (() => new Date())

  /*
   * Named rather than anonymous, and the name is load-bearing. Express records a
   * middleware's function name on the layer it makes, so `gate.routes.test.ts`
   * can find this one in the router stack and count what is registered on either
   * side of it.
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
       * rather than whenever their session happens to expire.
       */
      if (!live.enabled) return refuse(res, 'waiting')

      /*
       * Renewed on use, and only when it has gone stale. `renewSession` carries
       * the staleness test in its own `WHERE`, so two requests arriving together
       * cannot both decide to write.
       *
       * Both halves are renewed here: the row's window and the cookie's
       * `Max-Age`. Slide only the row and a browser drops the credential on day
       * thirty while the row it addresses is good to day sixty.
       *
       * Through `cookieOptions`, so a renewal cannot downgrade what it is
       * renewing. `Secure` is the one to say out loud: a renewal that dropped it
       * would hand a browser a cookie it would keep sending over plain http.
       */
      const staleFrom = new Date(clock().getTime() - RENEW_AFTER_MINUTES * 60_000)
      if (live.last_used_at < staleFrom.toISOString()) {
        await deps.store.renewSession(digest, clock())
        res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_MS))
      }

      /*
       * Who is asking, and the whole of the request context this app has: the
       * local user id, written once. The provider's subject is deliberately not
       * here, and neither is anything shaped like a permission.
       */
      res.locals.userId = live.user_id
      next()
    })().catch(next)
  })
}

function refuse(res: express.Response, state: 'anonymous' | 'waiting'): void {
  res.status(REFUSAL_STATUS[state]).json({
    state,
    error: state === 'anonymous'
      ? 'Sign in to use this.'
      : 'This account is signed in but has not been let in yet.',
  })
}
