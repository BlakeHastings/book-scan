/**
 * A whole sign-in, end to end, against a provider this repository does not know
 * the name of (#521).
 *
 * ## Why the provider is not Google
 *
 * #510 asked for the seam to be built so that a second provider is configuration
 * rather than surgery, and a claim like that is worth nothing until something
 * has been the second provider. So the provider driven here is invented in this
 * file: `acme`, with its own issuer, its own endpoints and its own client id,
 * handed to `createApp` as configuration and nowhere named in `server/`,
 * `infrastructure/` or `shared/`. Everything it exercises — the flow row, the
 * PKCE pair, the state cookie, the nonce, the token exchange, the user, the
 * session, the gate — is the same code Google walks.
 *
 * It also means these cases do not depend on Google being up, which matters for
 * a suite that runs on every pull request.
 *
 * ## What the stub is, and what it is not
 *
 * A four-line HTTP server on an ephemeral port that answers the token endpoint.
 * It is not an OpenID Connect implementation and does not pretend to be: what it
 * exists for is to be the far end of one `POST`, to record what arrived, and to
 * hand back whatever ID token a case wants — including the malformed ones,
 * which are half the point.
 *
 * The authorization endpoint is never visited. That half of the flow happens in
 * a browser at the provider's own site, and what this server does with it is
 * build a URL; so the URL is read rather than followed, which is also the only
 * way to get at the `state` and the `code_challenge` a real browser would have
 * carried invisibly.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { AuthStore } from '../infrastructure/auth/auth-store'
import { PgDb } from './db.pg'
import { createApp, type BookScanApp } from './index'
import { devProvider, signInFrom } from './auth/providers'
import { forgetDiscovered } from './auth/discovery'
import type { SignInProviderConfig } from './auth/providers'
import { SESSION_COOKIE } from '../shared/auth'

const ISSUER = 'https://acme.test'
const CLIENT_ID = 'a-client-this-repository-does-not-know'
const CLIENT_SECRET = 'a-secret-that-must-never-reach-a-browser'

let pool: pg.Pool
let db: PgDb
let scratch: string
let coverDir: string
let app: BookScanApp
let server: import('node:http').Server
let baseUrl: string

/** The stub provider, and what arrived at its token endpoint. */
let provider: Server
let providerUrl: string
let received: URLSearchParams | undefined
/** What the next token exchange gets back. A case sets this before calling. */
let nextToken: string
/**
 * How many discovery documents the stub has handed out, per authority (#537).
 *
 * Counted rather than assumed, because "the issuer is fetched rather than
 * hardcoded" and "the document is read once per process" are both claims about
 * requests, and the only honest way to check a claim about requests is to count
 * them at the far end.
 */
let documentsAsked: Record<string, number>

/**
 * The authorities this stub answers for, and what each one says about itself.
 *
 * Shaped like Microsoft's, which is the only reason a stub is worth anything
 * here: `wellhouse` answers with an issuer and is the case that works,
 * `templated` answers with a `{tenantid}` placeholder exactly as `common` and
 * `organizations` do, and `elsewhere` tries to nominate an issuer this stub does
 * not own.
 */
type Authorities = Record<string, (base: string) => Record<string, unknown>>

const freshAuthorities = (): Authorities => ({
  wellhouse: (base) => ({
    issuer: `${base}/wellhouse/v2.0`,
    authorization_endpoint: `${base}/wellhouse/authorize`,
    token_endpoint: `${base}/token`,
    subject_types_supported: ['pairwise'],
  }),
  templated: (base) => ({
    issuer: `${base}/{tenantid}/v2.0`,
    authorization_endpoint: `${base}/templated/authorize`,
    token_endpoint: `${base}/token`,
  }),
  elsewhere: (base) => ({
    issuer: 'https://an-issuer-this-document-does-not-own.test/v2.0',
    authorization_endpoint: `${base}/elsewhere/authorize`,
    token_endpoint: `${base}/token`,
  }),
})

/** Reset per case, so one of them can change an answer underneath a flow. */
let authorities: Authorities

/** Where a provider is told to go and ask about one of them. */
const discoveryFor = (authority: string) =>
  `${providerUrl}/${authority}/v2.0/.well-known/openid-configuration`

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('sign-in-routes')

  provider = createServer((req, res) => {
    const path = req.url ?? ''

    /*
     * The discovery half, added by #537. The token endpoint below was the whole
     * of this stub when there was only one shape of provider; a provider whose
     * issuer is not written down has to ask somebody, and this is the somebody.
     */
    const authority = /^\/([^/]+)\/v2\.0\/\.well-known\/openid-configuration$/.exec(path)?.[1]
    if (authority) {
      documentsAsked[authority] = (documentsAsked[authority] ?? 0) + 1
      const said = authorities[authority]
      if (!said) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{}')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(said(providerUrl)))
      return
    }

    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      received = new URLSearchParams(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id_token: nextToken, token_type: 'Bearer' }))
    })
  })
  provider.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => provider.once('listening', resolve))
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => { provider.close(() => resolve()) })
  await closeScratchDatabases()
  removeScratchRoot(scratch)
})

/** The configuration that makes `acme` a way in. Two URLs and two secrets. */
function acme(): SignInProviderConfig {
  return {
    id: 'acme',
    label: 'Acme',
    kind: 'oidc',
    issuer: ISSUER,
    // Its issuer is written down, so it asks nobody. That is the shape Google
    // has and the shape every provider had before #537.
    discovery: '',
    authorizationEndpoint: `${providerUrl}/authorize`,
    tokenEndpoint: `${providerUrl}/token`,
    scope: 'openid email profile',
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    subject: '',
    admitsOnSight: false,
  }
}

beforeEach(async () => {
  await pool.query('TRUNCATE "user", sign_in_flow CASCADE')
  received = undefined
  documentsAsked = {}
  authorities = freshAuthorities()
  forgetDiscovered()
  coverDir = mkdtempSync(join(scratch, 'covers-'))
  app = createApp({
    db,
    coverDir,
    startBackgroundWork: false,
    signIn: { providers: [acme()], publicOrigin: 'http://books.test' },
  })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await app.settled()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  rmSync(coverDir, { recursive: true, force: true })
})

/** An ID token, unsigned, because nothing verifies a signature. See oidc.ts. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return [
    part({ alg: 'RS256', typ: 'JWT' }),
    part(claims),
    'a-signature-nothing-reads',
  ].join('.')
}

/** The claims a well-behaved provider would send back. */
function goodClaims(nonce: string, over: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'acme-subject-1',
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce,
    email: 'somebody@acme.test',
    name: 'Some Body',
    ...over,
  }
}

/** One cookie out of a `Set-Cookie`, as a browser would keep it. */
function cookieIn(header: string | null, name: string): string {
  for (const one of (header ?? '').split(/,(?=[^;]+=)/)) {
    const [pair] = one.trim().split(';')
    if (pair?.startsWith(`${name}=`)) return pair
  }
  return ''
}

/** Begin a sign-in, and read what the browser would have been handed. */
async function begin(next = '/') {
  const response = await fetch(
    `${baseUrl}/api/auth/acme/start?next=${encodeURIComponent(next)}`,
    { redirect: 'manual' },
  )
  const location = new URL(response.headers.get('location') ?? '')
  return {
    status: response.status,
    location,
    state: location.searchParams.get('state') ?? '',
    nonce: location.searchParams.get('nonce') ?? '',
    challenge: location.searchParams.get('code_challenge') ?? '',
    flowCookie: cookieIn(response.headers.get('set-cookie'), 'bookscan_signin'),
  }
}

/** Come back from the provider, as the browser would. */
function callback(args: { state: string; code?: string; cookie: string }) {
  const query = new URLSearchParams({ code: args.code ?? 'an-authorization-code', state: args.state })
  return fetch(`${baseUrl}/api/auth/acme/callback?${query}`, {
    redirect: 'manual',
    headers: args.cookie ? { cookie: args.cookie } : {},
  })
}

describe('the authorization request this server builds', () => {
  it('asks for a code, with PKCE, at the provider it was configured with', async () => {
    const started = await begin('/library')

    expect(started.status).toBe(302)
    expect(started.location.origin + started.location.pathname).toBe(`${providerUrl}/authorize`)
    expect(started.location.searchParams.get('response_type')).toBe('code')
    expect(started.location.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(started.location.searchParams.get('scope')).toContain('openid')
    expect(started.location.searchParams.get('code_challenge_method')).toBe('S256')
    // The redirect URI is absolute and built from the configured origin, which
    // is the reason that variable is required at all: a provider will only
    // redirect to one it has been registered with, and that is an absolute URL.
    expect(started.location.searchParams.get('redirect_uri'))
      .toBe('http://books.test/api/auth/acme/callback')
  })

  it('never puts the client secret in the URL the browser follows', async () => {
    const started = await begin()
    expect(started.location.href).not.toContain(CLIENT_SECRET)
  })

  it('hands the browser the state as well, so the callback can require both', async () => {
    const started = await begin()
    expect(started.flowCookie).toBe(`bookscan_signin=${started.state}`)
  })

  /**
   * An open redirect would make this app's own sign-in the thing that lands
   * somebody on a page they did not ask for, with this app's name in the
   * address bar on the way there.
   */
  it('refuses to be told to redirect anywhere but a path on this origin', async () => {
    for (const asked of ['https://elsewhere.test/', '//elsewhere.test/', '/\\elsewhere.test']) {
      const started = await begin(asked)
      nextToken = idToken(goodClaims(started.nonce))
      const back = await callback({ state: started.state, cookie: started.flowCookie })
      expect(back.headers.get('location'), asked).toBe('/')
    }
  })
})

describe('the exchange, which happens server to server', () => {
  it('trades the code for a token, proving the PKCE verifier it started with', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))

    await callback({ state: started.state, code: 'the-code', cookie: started.flowCookie })

    expect(received?.get('grant_type')).toBe('authorization_code')
    expect(received?.get('code')).toBe('the-code')
    expect(received?.get('client_id')).toBe(CLIENT_ID)
    expect(received?.get('client_secret')).toBe(CLIENT_SECRET)
    expect(received?.get('redirect_uri')).toBe('http://books.test/api/auth/acme/callback')

    // The whole point of PKCE: the verifier is what the challenge in the
    // authorization request was the SHA-256 of, and only the server that made
    // the request has it.
    const verifier = received?.get('code_verifier') ?? ''
    expect(verifier).not.toBe('')
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(started.challenge)
  })

  it('signs the person in, and they arrive on the waiting list', async () => {
    const started = await begin('/library')
    nextToken = idToken(goodClaims(started.nonce))

    const back = await callback({ state: started.state, cookie: started.flowCookie })
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/library')

    const session = cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)
    expect(session).not.toBe('')

    /*
     * 403 and not 200, and that is the whole of #510's answer to "login with":
     * this person proved exactly who they are and is not admitted. Every person
     * on earth can get this far.
     */
    const asked = await fetch(`${baseUrl}/api/health`, { headers: { cookie: session } })
    expect(asked.status).toBe(403)
    expect(await asked.json()).toMatchObject({ state: 'waiting' })
  })

  it('lets them in once, and only once, somebody has enabled them', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))
    const back = await callback({ state: started.state, cookie: started.flowCookie })
    const session = cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)

    const store = new AuthStore(db)
    const [person] = await store.everybody()
    expect(person?.enabled).toBe(false)

    await store.setEnabled(person!.id, true, new Date())

    expect((await fetch(`${baseUrl}/api/health`, { headers: { cookie: session } })).status).toBe(200)
  })

  it('carries the session cookie with the attributes #521 asked for', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))
    const back = await callback({ state: started.state, cookie: started.flowCookie })
    const header = back.headers.get('set-cookie') ?? ''

    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
  })

  /**
   * The token is what the browser must never hold: a cookie addressing a row
   * this app can delete is revocable, and a provider's ID token is not.
   */
  it('never hands the provider\'s token to the browser', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))
    const back = await callback({ state: started.state, cookie: started.flowCookie })

    expect(back.headers.get('set-cookie') ?? '').not.toContain(nextToken)
    expect(await back.text()).not.toContain(nextToken)
  })
})

describe('the refusals, each driven on its own', () => {
  async function refusedBecause(over: Record<string, unknown>) {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce, over))
    const back = await callback({ state: started.state, cookie: started.flowCookie })
    expect(cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)).toBe('')
    return back.status
  }

  it('refuses a token from a different issuer', async () => {
    expect(await refusedBecause({ iss: 'https://someone-else.test' })).toBe(400)
  })

  it('refuses a token issued for a different application', async () => {
    expect(await refusedBecause({ aud: 'somebody-elses-client' })).toBe(400)
  })

  it('refuses a token that has expired', async () => {
    expect(await refusedBecause({ exp: Math.floor(Date.now() / 1000) - 1 })).toBe(400)
  })

  it('refuses a token that says nothing about who signed in', async () => {
    expect(await refusedBecause({ sub: undefined })).toBe(400)
  })

  /**
   * The nonce is what ties this token to this authorization request. Without
   * checking it, a token the provider minted for some other request of this
   * client's would be accepted here.
   */
  it('refuses a token whose nonce is not the one that went out', async () => {
    expect(await refusedBecause({ nonce: 'a-nonce-nobody-asked-for' })).toBe(400)
  })

  it('refuses a callback whose state the browser was never given', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))

    // The state is right and the cookie is somebody else's browser's. This is
    // login CSRF: an attacker completing their own authorization and feeding
    // the resulting URL to a victim.
    const back = await callback({ state: started.state, cookie: 'bookscan_signin=another-browser' })
    expect(back.status).toBe(400)
    expect(cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)).toBe('')
  })

  it('refuses a callback with no state at all', async () => {
    const started = await begin()
    const back = await fetch(`${baseUrl}/api/auth/acme/callback?code=x`, {
      redirect: 'manual',
      headers: { cookie: started.flowCookie },
    })
    expect(back.status).toBe(400)
  })

  /**
   * Single use, which is why the flow is a row rather than a cookie: the row is
   * deleted by the callback that consumes it, so a replayed authorization code
   * arrives with nothing left to check it against.
   */
  it('refuses the same callback a second time', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))

    expect((await callback({ state: started.state, cookie: started.flowCookie })).status).toBe(302)
    expect((await callback({ state: started.state, cookie: started.flowCookie })).status).toBe(400)
  })

  it('refuses a provider it was never configured with', async () => {
    expect((await fetch(`${baseUrl}/api/auth/google/start`, { redirect: 'manual' })).status).toBe(404)
    expect((await fetch(`${baseUrl}/api/auth/google/callback?code=x&state=y`)).status).toBe(404)
  })

  it('refuses a sign-in the person cancelled, without repeating what it said', async () => {
    const started = await begin()
    const back = await fetch(
      `${baseUrl}/api/auth/acme/callback?error=access_denied&state=${started.state}`,
      { redirect: 'manual', headers: { cookie: started.flowCookie } },
    )
    expect(back.status).toBe(400)
    expect(await back.text()).not.toContain('access_denied')
  })
})

describe('who a person is, across sign-ins', () => {
  async function signIn(over: Record<string, unknown>) {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce, over))
    const back = await callback({ state: started.state, cookie: started.flowCookie })
    return cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)
  }

  it('finds the same person on a second sign-in, rather than making another', async () => {
    await signIn({})
    await signIn({})

    expect(await new AuthStore(db).everybody()).toHaveLength(1)
  })

  it('follows the subject when the email changes underneath it', async () => {
    await signIn({ email: 'somebody@acme.test' })
    await signIn({ email: 'they-changed-it@acme.test' })

    const everyone = await new AuthStore(db).everybody()
    expect(everyone).toHaveLength(1)
    // Refreshed, because the provider is the authority on it and it is a label.
    expect(everyone[0]?.identities[0]?.email).toBe('they-changed-it@acme.test')
  })

  /**
   * The one #510 calls an account takeover if it is got wrong: two providers,
   * or two subjects, asserting one address is not proof of one person.
   *
   * Here it is the same provider and two subjects, which is the same claim and
   * is the case this code can be driven through. A `user_identity` keyed on
   * email would fold these two into one account; keyed on `(issuer, subject)` it
   * cannot, and this is what would fail the day somebody "helpfully" added a
   * lookup by address.
   */
  it('does not join two subjects into one person because they share an address', async () => {
    await signIn({ sub: 'acme-subject-1', email: 'shared@acme.test' })
    await signIn({ sub: 'acme-subject-2', email: 'shared@acme.test' })

    const everyone = await new AuthStore(db).everybody()
    expect(everyone).toHaveLength(2)
    expect(everyone[0]?.id).not.toBe(everyone[1]?.id)
  })

  it('keeps a person disabled across sign-ins, so signing in again is not a way in', async () => {
    await signIn({})
    const session = await signIn({})

    expect((await fetch(`${baseUrl}/api/health`, { headers: { cookie: session } })).status).toBe(403)
  })
})

describe('what the client is told, in each of the three states', () => {
  it('says anonymous to somebody with no cookie, and nothing else', async () => {
    const answer = await (await fetch(`${baseUrl}/api/auth/session`)).json()
    expect(answer).toEqual({ state: 'anonymous' })
  })

  it('says waiting, and who is waiting, to somebody not admitted', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))
    const back = await callback({ state: started.state, cookie: started.flowCookie })
    const session = cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)

    const answer = await (await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: session },
    })).json()

    expect(answer.state).toBe('waiting')
    expect(answer.user).toMatchObject({ enabled: false, email: 'somebody@acme.test' })
    // The provider's subject is on `user_identity` and nowhere else, and it does
    // not reach a screen either.
    expect(JSON.stringify(answer)).not.toContain('acme-subject-1')
  })

  it('says admitted once somebody has been let in', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))
    const back = await callback({ state: started.state, cookie: started.flowCookie })
    const session = cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)

    const store = new AuthStore(db)
    const [person] = await store.everybody()
    await store.setEnabled(person!.id, true, new Date())

    const answer = await (await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: session },
    })).json()
    expect(answer.state).toBe('admitted')
  })

  it('lists the ways in, so a login screen has something to draw', async () => {
    const answer = await (await fetch(`${baseUrl}/api/auth/providers`)).json()
    expect(answer).toEqual({
      providers: [{ id: 'acme', label: 'Acme', start: '/api/auth/acme/start' }],
    })
  })

  /**
   * Open, and this one is a judgement rather than a necessity. Somebody on the
   * waiting-list screen is refused 403 everywhere; if signing out were behind
   * the gate they could not sign out, which is the one thing that screen has to
   * offer a person who picked the wrong account.
   */
  it('lets somebody on the waiting list sign out', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))
    const back = await callback({ state: started.state, cookie: started.flowCookie })
    const session = cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)

    const out = await fetch(`${baseUrl}/api/auth/signout`, {
      method: 'POST',
      headers: { cookie: session },
    })
    expect(out.status).toBe(204)

    const after = await (await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: session },
    })).json()
    expect(after).toEqual({ state: 'anonymous' })
  })

  it('lets somebody with no session sign out, and does nothing', async () => {
    expect((await fetch(`${baseUrl}/api/auth/signout`, { method: 'POST' })).status).toBe(204)
  })
})

/**
 * A provider whose issuer is not written down anywhere, driven end to end
 * (#537).
 *
 * ## What this is, and what it is not
 *
 * **It is not Microsoft.** Driving Microsoft needs an app registration with a
 * client id and a secret the owner has not created and which must never enter
 * this repository, so nothing in this file has ever spoken to Microsoft and
 * nothing claims to have. What it is, is the *shape* Microsoft has, run through
 * the whole flow: an authority that answers a discovery document, an issuer that
 * exists only in that answer, and a second tenant on the same authority whose
 * tokens must be refused.
 *
 * **A stub is honest here and a claim is not**, which is the precedent #523 set
 * with `acme` above. What it can prove is what `auth/discovery.ts` and this
 * server do with a document and with a token; what it cannot prove is that
 * Microsoft answers the way `discovery.test.ts`'s fixtures say it does. Those
 * fixtures were read from Microsoft's own public documents and say where and
 * when, which is the closest a repository with no registration can get.
 *
 * The case that matters is `refuses a token from another tenant`. Everything
 * else here is a sign-in that works, and #537's whole point is that a sign-in
 * that works is exactly what the defect looks like.
 */
describe('a provider whose issuer is discovered rather than written down', () => {
  let discovered: BookScanApp
  let discoveredServer: import('node:http').Server
  let url: string

  /** The row, with a hole where every other provider carries three constants. */
  const wellhouse = (authority = 'wellhouse'): SignInProviderConfig => ({
    id: 'wellhouse',
    label: 'Wellhouse',
    kind: 'oidc',
    issuer: '',
    discovery: discoveryFor(authority),
    authorizationEndpoint: '',
    tokenEndpoint: '',
    scope: 'openid email profile',
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    subject: '',
    admitsOnSight: false,
  })

  async function boot(row: SignInProviderConfig) {
    discovered = createApp({
      db,
      coverDir,
      startBackgroundWork: false,
      signIn: { providers: [row], publicOrigin: 'http://books.test' },
    })
    discoveredServer = discovered.listen(0)
    await new Promise<void>((resolve) => discoveredServer.once('listening', resolve))
    url = `http://127.0.0.1:${(discoveredServer.address() as AddressInfo).port}`
  }

  afterEach(async () => {
    await discovered.settled()
    await new Promise<void>((resolve) => { discoveredServer.close(() => resolve()) })
  })

  async function start(next = '/') {
    const response = await fetch(
      `${url}/api/auth/wellhouse/start?next=${encodeURIComponent(next)}`,
      { redirect: 'manual' },
    )
    const location = response.status === 302
      ? new URL(response.headers.get('location') ?? '')
      : undefined
    return {
      status: response.status,
      location,
      state: location?.searchParams.get('state') ?? '',
      nonce: location?.searchParams.get('nonce') ?? '',
      cookie: cookieIn(response.headers.get('set-cookie'), 'bookscan_signin'),
    }
  }

  const comeBack = (state: string, cookie: string) => fetch(
    `${url}/api/auth/wellhouse/callback?code=a-code&state=${state}`,
    { redirect: 'manual', headers: cookie ? { cookie } : {} },
  )

  it('sends the browser to the endpoint the document named, not to one written here', async () => {
    await boot(wellhouse())
    const began = await start('/library')

    expect(began.status).toBe(302)
    // The row's `authorizationEndpoint` is the empty string. This URL exists
    // only because the document was fetched and read.
    expect(`${began.location?.origin ?? ''}${began.location?.pathname ?? ''}`)
      .toBe(`${providerUrl}/wellhouse/authorize`)
    expect(documentsAsked.wellhouse).toBe(1)
  })

  it('signs somebody in, and files them under the issuer the document named', async () => {
    await boot(wellhouse())
    const began = await start('/library')
    nextToken = idToken({
      iss: `${providerUrl}/wellhouse/v2.0`,
      aud: CLIENT_ID,
      sub: 'a-pairwise-subject',
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: began.nonce,
      email: 'somebody@wellhouse.test',
      name: 'Some Body',
    })

    const back = await comeBack(began.state, began.cookie)
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/library')

    const [person] = await new AuthStore(db).everybody()
    /*
     * The discovered issuer, on `user_identity`, and not the empty string the
     * row carries. If the callback read the field rather than the resolved
     * provider, every identity would be filed under `''` and two providers with
     * the same subject would be one person.
     */
    expect(person?.identities[0]?.issuer).toBe(`${providerUrl}/wellhouse/v2.0`)
    expect(person?.identities[0]?.subject).toBe('a-pairwise-subject')
    // A real provider, so the waiting list, as Google's first sign-in gives.
    expect(person?.enabled).toBe(false)
  })

  /**
   * **The case #537 exists for.**
   *
   * Every claim in this token is right except one: it was issued by a different
   * tenant on the same authority. That is exactly what a real Microsoft token
   * from somebody else's Entra tenant looks like, and it is what a check written
   * as "the issuer starts with the authority's host" would let through while
   * still producing a sign-in that succeeds and a session that works.
   *
   * A wrong issuer check is not visible from a happy path. It is visible here.
   */
  it('refuses a token from another tenant on the same authority', async () => {
    await boot(wellhouse())
    const began = await start()
    nextToken = idToken({
      iss: `${providerUrl}/somebody-elses-tenant/v2.0`,
      aud: CLIENT_ID,
      sub: 'a-pairwise-subject',
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: began.nonce,
      email: 'somebody@wellhouse.test',
    })

    const back = await comeBack(began.state, began.cookie)

    expect(back.status).toBe(400)
    expect(cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)).toBe('')
    expect(await new AuthStore(db).everybody()).toHaveLength(0)
  })

  it('reads the document once, however many sign-ins go through it', async () => {
    await boot(wellhouse())
    for (let i = 0; i < 3; i += 1) {
      const began = await start()
      nextToken = idToken({
        iss: `${providerUrl}/wellhouse/v2.0`,
        aud: CLIENT_ID,
        sub: 'a-pairwise-subject',
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: began.nonce,
      })
      expect((await comeBack(began.state, began.cookie)).status).toBe(302)
    }

    // Three sign-ins, three authorization requests, three exchanges, and one
    // document.
    expect(documentsAsked.wellhouse).toBe(1)
    expect(await new AuthStore(db).everybody()).toHaveLength(1)
  })

  /**
   * `common` and `organizations`, in the only form a stub can have them:
   * an authority whose document answers `{tenantid}` instead of an issuer.
   * `providers.ts` also refuses those two by name at start, which is the same
   * answer arriving sooner; this is the refusal that would still hold for an
   * authority nobody has thought of.
   */
  it('refuses an authority that answers with a template, and signs nobody in', async () => {
    await boot(wellhouse('templated'))

    const began = await start()
    expect(began.status).toBe(502)
    expect(began.cookie).toBe('')

    // And nothing was half-started: no flow row to replay and no user.
    expect((await pool.query('SELECT * FROM sign_in_flow')).rowCount).toBe(0)
    expect(await new AuthStore(db).everybody()).toHaveLength(0)
  })

  it('refuses an authority that names an issuer it does not own', async () => {
    await boot(wellhouse('elsewhere'))
    expect((await start()).status).toBe(502)
  })

  it('refuses an authority that is not there at all', async () => {
    await boot(wellhouse('an-authority-this-stub-has-never-heard-of'))
    expect((await start()).status).toBe(502)
  })

  /**
   * The callback resolves too, and it has to.
   *
   * The situation is ordinary rather than contrived: a sign-in that began before
   * a restart comes back after one, so nothing is cached and the document is
   * asked for again. If the authority has stopped being able to say what its
   * issuer is, the answer is to refuse, because the alternative shape, "carry on
   * and sort the issuer out later", is how a provider ends up admitting a token
   * nothing checked.
   */
  it('refuses at the callback when the authority stops answering usefully', async () => {
    await boot(wellhouse())
    const began = await start()
    expect(began.status).toBe(302)

    // The restart, and the authority now answering the way `common` does.
    forgetDiscovered()
    authorities.wellhouse = authorities.templated!

    nextToken = idToken({
      iss: `${providerUrl}/wellhouse/v2.0`,
      aud: CLIENT_ID,
      sub: 'a-pairwise-subject',
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: began.nonce,
    })
    const back = await comeBack(began.state, began.cookie)

    expect(back.status).toBe(502)
    expect(cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)).toBe('')
    expect(await new AuthStore(db).everybody()).toHaveLength(0)
    expect(documentsAsked.wellhouse).toBe(2)
  })
})

/**
 * The development door, driven rather than described.
 *
 * It is the answer to "development must keep working" and #521 asked for the
 * argument as well as the mechanism. The mechanism is here; the argument is on
 * `devProvider` and in `docs/the-gate.md`. What these cases pin is the part of
 * the argument that is checkable: it is a provider rather than a bypass, and it
 * cannot be on at the same time as a real one.
 */
describe('the development door', () => {
  let dev: BookScanApp
  let devServer: import('node:http').Server
  let devUrl: string

  beforeEach(async () => {
    dev = createApp({
      db,
      coverDir,
      startBackgroundWork: false,
      signIn: { providers: [devProvider('a-developer')], publicOrigin: '' },
    })
    devServer = dev.listen(0)
    await new Promise<void>((resolve) => devServer.once('listening', resolve))
    devUrl = `http://127.0.0.1:${(devServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await dev.settled()
    await new Promise<void>((resolve) => { devServer.close(() => resolve()) })
  })

  it('signs a developer in, enabled, in one request and with no provider asked', async () => {
    const back = await fetch(`${devUrl}/api/auth/dev/start`, { redirect: 'manual' })
    expect(back.status).toBe(302)
    const session = cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)

    expect((await fetch(`${devUrl}/api/health`, { headers: { cookie: session } })).status).toBe(200)
  })

  it('is a provider and not a bypass: without its cookie the gate still refuses', async () => {
    await fetch(`${devUrl}/api/auth/dev/start`, { redirect: 'manual' })
    expect((await fetch(`${devUrl}/api/health`)).status).toBe(401)
  })

  it('files the developer under an issuer no provider could ever assert', async () => {
    await fetch(`${devUrl}/api/auth/dev/start`, { redirect: 'manual' })
    const [person] = await new AuthStore(db).everybody()
    expect(person?.identities[0]?.issuer).toBe('bookscan:dev')
    expect(person?.identities[0]?.subject).toBe('a-developer')
  })

  it('is not there at all when configuration has not put it there', async () => {
    const shut = createApp({ db, coverDir, startBackgroundWork: false })
    const listener = shut.listen(0)
    await new Promise<void>((resolve) => listener.once('listening', resolve))
    const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
    try {
      expect((await fetch(`${url}/api/auth/dev/start`, { redirect: 'manual' })).status).toBe(404)
      expect(await (await fetch(`${url}/api/auth/providers`)).json()).toEqual({ providers: [] })
      // And with no way in, everything is refused. A server with no gate and a
      // server with no way through it look nothing alike.
      expect((await fetch(`${url}/api/health`)).status).toBe(401)
    } finally {
      await shut.settled()
      await new Promise<void>((resolve) => { listener.close(() => resolve()) })
    }
  })
})

/**
 * What configuration is allowed to say, and the three things it is refused.
 *
 * A process that exits naming a variable is recoverable in one command; one that
 * comes up with the wrong door open is not obviously anything.
 */
describe('reading the environment', () => {
  it('builds Google out of two variables and an origin', () => {
    const config = signInFrom({
      BOOKSCAN_OIDC_GOOGLE_CLIENT_ID: 'an-id',
      BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET: 'a-secret',
      BOOKSCAN_PUBLIC_ORIGIN: 'https://books.example/',
    })

    expect(config.providers).toHaveLength(1)
    expect(config.providers[0]).toMatchObject({
      id: 'google',
      issuer: 'https://accounts.google.com',
      clientId: 'an-id',
      admitsOnSight: false,
    })
    // The trailing slash goes, so the redirect URI is not built with two.
    expect(config.publicOrigin).toBe('https://books.example')
  })

  it('has no way in at all when nothing is configured', () => {
    expect(signInFrom({}).providers).toEqual([])
  })

  it('refuses half a Google', () => {
    expect(() => signInFrom({ BOOKSCAN_OIDC_GOOGLE_CLIENT_ID: 'an-id' }))
      .toThrow(/BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET/)
  })

  it('refuses a provider with nowhere to redirect back to', () => {
    expect(() => signInFrom({
      BOOKSCAN_OIDC_GOOGLE_CLIENT_ID: 'an-id',
      BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET: 'a-secret',
    })).toThrow(/BOOKSCAN_PUBLIC_ORIGIN/)
  })

  /**
   * The one with teeth. A deployment that has configured Google cannot also be
   * carrying the development door, which is the moment somebody would otherwise
   * have left it on.
   */
  it('refuses the development door beside a real provider', () => {
    expect(() => signInFrom({
      BOOKSCAN_OIDC_GOOGLE_CLIENT_ID: 'an-id',
      BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET: 'a-secret',
      BOOKSCAN_PUBLIC_ORIGIN: 'https://books.example',
      BOOKSCAN_DEV_SIGN_IN: 'a-developer',
    })).toThrow(/BOOKSCAN_DEV_SIGN_IN/)
  })

  it('needs no origin for the development door, which redirects to nowhere', () => {
    const config = signInFrom({ BOOKSCAN_DEV_SIGN_IN: 'a-developer' })
    expect(config.providers).toHaveLength(1)
    expect(config.providers[0]?.kind).toBe('trusted')
  })

  it('is the only provider in this codebase that admits anybody on sight', () => {
    const configured = signInFrom({
      BOOKSCAN_OIDC_GOOGLE_CLIENT_ID: 'an-id',
      BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET: 'a-secret',
      BOOKSCAN_PUBLIC_ORIGIN: 'https://books.example',
    })
    for (const one of configured.providers) expect(one.admitsOnSight).toBe(false)
    expect(devProvider('x').admitsOnSight).toBe(true)
  })
})

/** A shape a case above depends on, kept honest rather than assumed. */
it('makes a different opaque value every time', () => {
  const seen = new Set(Array.from({ length: 50 }, () => randomBytes(32).toString('base64url')))
  expect(seen.size).toBe(50)
})
