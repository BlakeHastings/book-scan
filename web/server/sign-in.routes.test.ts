/**
 * These tests run against `acme`, an invented OIDC provider stubbed by a bare
 * HTTP server that only answers the token endpoint, so the suite does not
 * depend on Google being up. The authorization endpoint is never visited: that
 * half of the flow happens in a real browser, so its URL is read here (for
 * `state` and `code_challenge`) rather than followed.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeTestDatabase, openTestDatabase } from './testdb'
import { AuthStore, SESSION_DAYS } from '../infrastructure/auth/auth-store'
import type { Db } from './driver'
import { createApp, type BookScanApp } from './index'
import { devProvider, signInFrom } from './auth/providers'
import { forgetDiscovered } from './auth/discovery'
import type { SignInProviderConfig } from './auth/providers'
import { SESSION_COOKIE } from '../shared/auth'

const ISSUER = 'https://acme.test'
const CLIENT_ID = 'a-client-this-repository-does-not-know'
const CLIENT_SECRET = 'a-secret-that-must-never-reach-a-browser'

/** One `Db` for the file. `openTestDatabase` hands back the same one each time. */
let db: Db
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
 * Distinguishes a provider that said no from one that could not be asked at
 * all, since the callback has to tell those apart.
 */
let tokenStatus: number
let tokenEndpointDown: boolean
/**
 * Counted per authority, so a claim like "the document is read once per
 * process" can be checked by counting requests rather than assumed.
 */
let documentsAsked: Record<string, number>

/**
 * Shaped like Microsoft's: `templated` answers with a `{tenantid}` placeholder
 * as `common` and `organizations` do, and `elsewhere` nominates an issuer the
 * stub does not own.
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
  scratch = scratchRoot('sign-in-routes')

  provider = createServer((req, res) => {
    const path = req.url ?? ''

    /* A provider whose issuer is not written down has to ask somebody; this answers that. */
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
      /*
       * Hung up on rather than answered: the only honest way to make `fetch`
       * fail like an unreachable host, as opposed to a stub that answered 503.
       */
      if (tokenEndpointDown) {
        req.socket.destroy()
        return
      }
      res.writeHead(tokenStatus, { 'content-type': 'application/json' })
      res.end(JSON.stringify(
        nextToken ? { id_token: nextToken, token_type: 'Bearer' } : { token_type: 'Bearer' },
      ))
    })
  })
  provider.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => provider.once('listening', resolve))
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => { provider.close(() => resolve()) })
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

/** The configuration that makes `acme` a way in. Two URLs and two secrets. */
function acme(): SignInProviderConfig {
  return {
    id: 'acme',
    label: 'Acme',
    kind: 'oidc',
    issuer: ISSUER,
    // Its issuer is written down, so it asks nobody, the same shape Google has.
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
  db = await openTestDatabase()
  received = undefined
  tokenStatus = 200
  tokenEndpointDown = false
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

    // The verifier is what the challenge in the authorization request was the
    // SHA-256 of; only the server that made the request has it.
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

    /* 403, not 401: this person proved who they are and is simply not admitted yet. */
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

/**
 * These routes are reached only by a top-level browser navigation, so the
 * answer must be a redirect back to a screen, not a JSON body; each case
 * checks for that plus which of the six reasons it carries.
 */
describe('every way a sign-in can fail, and what a browser is handed', () => {
  /** The reason a redirect carries, or empty when it carries none. */
  function troubleIn(response: Response): string {
    const location = response.headers.get('location') ?? ''
    return new URL(location, 'http://books.test').searchParams.get('signin') ?? ''
  }

  /** Which way in the redirect named, so the screen can say the label. */
  function wayIn(response: Response): string {
    const location = response.headers.get('location') ?? ''
    return new URL(location, 'http://books.test').searchParams.get('way') ?? ''
  }

  /**
   * Checks three things, not just the status: a `302` that still writes a JSON
   * object would pass a status check and be exactly as broken. Express's
   * default redirect body ("Found. Redirecting to ...") is not a message this
   * app wrote; content type is what tells the two apart.
   */
  async function sendsBackSaying(response: Response, trouble: string) {
    expect(response.status, 'answered a browser with something to render').toBe(302)
    expect(response.headers.get('content-type') ?? '', 'answered a browser with JSON')
      .not.toContain('application/json')
    expect(response.headers.get('location') ?? '').toMatch(/^\/\?/)
    expect(troubleIn(response)).toBe(trouble)
    expect(cookieIn(response.headers.get('set-cookie'), SESSION_COOKIE)).toBe('')
  }

  function refusedBecause(over: Record<string, unknown>) {
    return begin().then(async (started) => {
      nextToken = idToken(goodClaims(started.nonce, over))
      return callback({ state: started.state, cookie: started.flowCookie })
    })
  }

  /*
   * All six of these collapse to `refused`: none of them give a person a
   * different next action, so the distinct reasons are kept in the log
   * (`oidc.ts`) rather than shown.
   */
  it('refuses a token from a different issuer', async () => {
    await sendsBackSaying(await refusedBecause({ iss: 'https://someone-else.test' }), 'refused')
  })

  it('refuses a token issued for a different application', async () => {
    await sendsBackSaying(await refusedBecause({ aud: 'somebody-elses-client' }), 'refused')
  })

  it('refuses a token that has expired', async () => {
    await sendsBackSaying(
      await refusedBecause({ exp: Math.floor(Date.now() / 1000) - 1 }), 'refused',
    )
  })

  it('refuses a token that says nothing about who signed in', async () => {
    await sendsBackSaying(await refusedBecause({ sub: undefined }), 'refused')
  })

  /**
   * The nonce is what ties this token to this authorization request. Without
   * checking it, a token the provider minted for some other request of this
   * client's would be accepted here.
   */
  it('refuses a token whose nonce is not the one that went out', async () => {
    await sendsBackSaying(
      await refusedBecause({ nonce: 'a-nonce-nobody-asked-for' }), 'refused',
    )
  })

  it('refuses an exchange the provider itself said no to', async () => {
    tokenStatus = 401
    const started = await begin()
    await sendsBackSaying(
      await callback({ state: started.state, cookie: started.flowCookie }), 'refused',
    )
  })

  it('refuses an answer from the token endpoint with no ID token in it', async () => {
    nextToken = ''
    const started = await begin()
    await sendsBackSaying(
      await callback({ state: started.state, cookie: started.flowCookie }), 'refused',
    )
  })

  /**
   * `unavailable`, not `refused`: nobody was asked, so nothing was decided, and
   * "try again in a minute" is honest advice here, unlike in the refused cases above.
   */
  it('says nobody could be asked when the token endpoint cannot be reached', async () => {
    tokenEndpointDown = true
    const started = await begin()
    await sendsBackSaying(
      await callback({ state: started.state, cookie: started.flowCookie }), 'unavailable',
    )
  })

  it('refuses a callback whose state the browser was never given', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))

    // The state is right and the cookie is somebody else's browser's. This is
    // login CSRF: an attacker completing their own authorization and feeding
    // the resulting URL to a victim.
    const back = await callback({ state: started.state, cookie: 'bookscan_signin=another-browser' })
    await sendsBackSaying(back, 'stale')
  })

  it('refuses a callback with no state at all', async () => {
    const started = await begin()
    const back = await fetch(`${baseUrl}/api/auth/acme/callback?code=x`, {
      redirect: 'manual',
      headers: { cookie: started.flowCookie },
    })
    await sendsBackSaying(back, 'stale')
  })

  /**
   * The callback clears the flow cookie on its way past, so pressing Back lands
   * here with a state and no cookie, the same exit a reopened link reaches.
   * `stale` covers both, since `already-used` would describe a mechanism this
   * (mostly innocent) case never touched.
   */
  it('lands a Back press after a finished sign-in on the stale exit, not the used one', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))

    const first = await callback({ state: started.state, cookie: started.flowCookie })
    expect(first.status).toBe(302)
    expect(first.headers.get('location')).toBe('/')
    const cleared = (first.headers.get('set-cookie') ?? '').includes('bookscan_signin=;')
    expect(cleared, 'the callback did not clear the flow cookie').toBe(true)

    await sendsBackSaying(await callback({ state: started.state, cookie: '' }), 'stale')
  })

  /**
   * The flow is a row, not a cookie, so it can be deleted on first use: a
   * replayed callback then has nothing left to check against. `already-used`,
   * not `stale`, because the cookie is still presented here, unlike a genuine
   * Back press.
   */
  it('refuses the same callback a second time', async () => {
    const started = await begin()
    nextToken = idToken(goodClaims(started.nonce))

    expect((await callback({ state: started.state, cookie: started.flowCookie })).status).toBe(302)
    await sendsBackSaying(
      await callback({ state: started.state, cookie: started.flowCookie }), 'already-used',
    )
  })

  /**
   * These routes are reached only by a browser (for example, a bookmark that
   * outlived a provider), so a `404` with a JSON body is not an answer anybody
   * can act on; it redirects instead, like every other exit in this block.
   */
  it('refuses a provider it was never configured with, on both doors', async () => {
    await sendsBackSaying(
      await fetch(`${baseUrl}/api/auth/google/start`, { redirect: 'manual' }), 'no-such-way',
    )
    await sendsBackSaying(
      await fetch(`${baseUrl}/api/auth/google/callback?code=x&state=y`, { redirect: 'manual' }),
      'no-such-way',
    )
  })

  /**
   * Must not be told the same thing as the two cases above: somebody pressed
   * Cancel, nothing is broken, and the sentence they get should say so.
   */
  it('tells somebody who cancelled that they cancelled, and does not repeat what the provider said', async () => {
    const started = await begin()
    const back = await fetch(
      `${baseUrl}/api/auth/acme/callback?error=access_denied&state=${started.state}`,
      { redirect: 'manual', headers: { cookie: started.flowCookie } },
    )
    await sendsBackSaying(back, 'cancelled')
    // The provider's own words are untrusted text; they must not appear in the redirect either.
    expect(back.headers.get('location') ?? '').not.toContain('access_denied')
  })

  /**
   * `server_error`, `invalid_client`, and the rest of OAuth 2.0 section 4.1.2.1
   * are faults, not choices; telling somebody they cancelled when their sign-in
   * is broken would be untrue.
   */
  it('does not tell somebody they cancelled when the provider reported a fault', async () => {
    for (const said of ['server_error', 'invalid_client', 'temporarily_unavailable']) {
      const started = await begin()
      const back = await fetch(
        `${baseUrl}/api/auth/acme/callback?error=${said}&state=${started.state}`,
        { redirect: 'manual', headers: { cookie: started.flowCookie } },
      )
      await sendsBackSaying(back, 'refused')
    }
  })

  it('refuses a callback carrying neither an error nor a code', async () => {
    const started = await begin()
    const back = await fetch(
      `${baseUrl}/api/auth/acme/callback?state=${started.state}`,
      { redirect: 'manual', headers: { cookie: started.flowCookie } },
    )
    await sendsBackSaying(back, 'refused')
  })

  /**
   * Only the id travels in the URL; the client looks up the label from
   * `GET /api/auth/providers`, so nothing here lets a screen read a stranger's
   * text out loud.
   */
  it('names which way in it was, by id, on the exits that know', async () => {
    const started = await begin()
    const back = await fetch(
      `${baseUrl}/api/auth/acme/callback?error=access_denied&state=${started.state}`,
      { redirect: 'manual', headers: { cookie: started.flowCookie } },
    )
    expect(wayIn(back)).toBe('acme')
    expect(back.headers.get('location')).not.toContain('Acme')
  })

  /** There is nothing knowable about a provider this server does not have. */
  it('names no way in when there is no such way', async () => {
    const back = await fetch(`${baseUrl}/api/auth/google/start`, { redirect: 'manual' })
    expect(wayIn(back)).toBe('')
  })

  /**
   * Asserts the property directly, since a new exit added later could easily
   * reproduce the same mistake without being caught by the individual cases above.
   */
  it('never answers either door with a body, whatever went wrong', async () => {
    const started = await begin()
    const asks = [
      `${baseUrl}/api/auth/nobody/start`,
      `${baseUrl}/api/auth/nobody/callback?code=x&state=y`,
      `${baseUrl}/api/auth/acme/callback?error=access_denied&state=${started.state}`,
      `${baseUrl}/api/auth/acme/callback?code=x&state=not-the-one`,
      `${baseUrl}/api/auth/acme/callback?state=${started.state}`,
      `${baseUrl}/api/auth/acme/callback`,
    ]
    for (const ask of asks) {
      const back = await fetch(ask, { redirect: 'manual', headers: { cookie: started.flowCookie } })
      expect(back.status, ask).toBe(302)
      expect(back.headers.get('content-type') ?? '', ask).not.toContain('application/json')
      expect(await back.text(), ask).not.toContain('"error"')
      expect(troubleIn(back), ask).not.toBe('')
    }
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
   * `user_identity` is keyed on `(issuer, subject)`, not email: an address is
   * not proof of one person, and a lookup by email would wrongly fold these two
   * accounts into one.
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
   * Sign out must stay open: somebody on the waiting list is refused everywhere
   * else, and being unable to sign out would leave them with no way to pick a
   * different account.
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
 * Runs the shape Microsoft's discovery flow has (an authority whose issuer
 * only exists in its discovery document, and a second tenant whose tokens must
 * be refused) without a real app registration; it proves what this server does
 * with a document and a token, not that Microsoft answers the way
 * `discovery.test.ts`'s fixtures say it does.
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
    /*
     * Parsed against a base since a start redirects to one of two places: out
     * to the authority (absolute) or back to the login screen (a path); the
     * base is ignored by the first.
     */
    const location = response.status === 302
      ? new URL(response.headers.get('location') ?? '', 'http://books.test')
      : undefined
    return {
      status: response.status,
      location,
      state: location?.searchParams.get('state') ?? '',
      nonce: location?.searchParams.get('nonce') ?? '',
      // Which of the six, when this start was a refusal rather than a journey
      // out. A start that worked redirects to the authority and carries none.
      trouble: location?.searchParams.get('signin') ?? '',
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
    expect(person?.enabled).toBe(false)
  })

  /**
   * A check written as "the issuer starts with the authority's host" would let
   * this through while still producing a sign-in that succeeds: a wrong issuer
   * check is not visible from a happy path, only from a case like this.
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

    // Told `refused` rather than `cancelled`: nobody chose this and nobody
    // undoes it by pressing the button again.
    expect(back.status).toBe(302)
    expect(new URL(back.headers.get('location') ?? '', 'http://books.test')
      .searchParams.get('signin')).toBe('refused')
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

    expect(documentsAsked.wellhouse).toBe(1)
    expect(await new AuthStore(db).everybody()).toHaveLength(1)
  })

  /**
   * `providers.ts` also refuses `common` and `organizations` by name at start;
   * this is the more general refusal that would still hold for an authority
   * nobody has named.
   */
  it('refuses an authority that answers with a template, and signs nobody in', async () => {
    await boot(wellhouse('templated'))

    const began = await start()
    /* `unavailable`: an authority that will not say what its issuer is has nothing to do with whoever pressed the button. */
    expect(began.status).toBe(302)
    expect(began.trouble).toBe('unavailable')
    expect(began.cookie).toBe('')

    // Nothing was half-started: no flow row to replay and no user.
    expect(await db.all('SELECT * FROM sign_in_flow')).toHaveLength(0)
    expect(await new AuthStore(db).everybody()).toHaveLength(0)
  })

  it('refuses an authority that names an issuer it does not own', async () => {
    await boot(wellhouse('elsewhere'))
    expect((await start()).trouble).toBe('unavailable')
  })

  it('refuses an authority that is not there at all', async () => {
    await boot(wellhouse('an-authority-this-stub-has-never-heard-of'))
    expect((await start()).trouble).toBe('unavailable')
  })

  /**
   * A sign-in that began before a restart comes back after one, so nothing is
   * cached and the document is asked for again; if the authority cannot say
   * what its issuer is, refusing is the only safe answer, since "sort it out
   * later" is how a provider ends up admitting an unchecked token.
   */
  it('refuses at the callback when the authority stops answering usefully', async () => {
    await boot(wellhouse())
    const began = await start()
    expect(began.status).toBe(302)

    // Simulates the restart: the authority now answers the way `common` does.
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

    expect(back.status).toBe(302)
    expect(new URL(back.headers.get('location') ?? '', 'http://books.test')
      .searchParams.get('signin')).toBe('unavailable')
    expect(cookieIn(back.headers.get('set-cookie'), SESSION_COOKIE)).toBe('')
    expect(await new AuthStore(db).everybody()).toHaveLength(0)
    expect(documentsAsked.wellhouse).toBe(2)
  })
})

/** A provider rather than a bypass; it cannot be on at the same time as a real one. See `docs/the-gate.md`. */
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
      // A browser asks this, so it is sent back to the login screen rather than a 404.
      const shutDoor = await fetch(`${url}/api/auth/dev/start`, { redirect: 'manual' })
      expect(shutDoor.headers.get('location')).toBe('/?signin=no-such-way')
      expect(await (await fetch(`${url}/api/auth/providers`)).json()).toEqual({ providers: [] })
      // With no way in configured, the gate still refuses everything: no
      // providers is not the same as no gate.
      expect((await fetch(`${url}/api/health`)).status).toBe(401)
    } finally {
      await shut.settled()
      await new Promise<void>((resolve) => { listener.close(() => resolve()) })
    }
  })
})

/**
 * Compares the renewed cookie against what `admit` wrote, rather than a
 * literal, so a change that quietly drops `Secure` fails here instead of in
 * production. Driven through the development door because it is a single
 * `GET` with no provider to stub, and `admit` is the same code whichever door reaches it.
 */
describe('the thirty days the browser is holding', () => {
  let renewing: BookScanApp
  let renewingServer: import('node:http').Server
  let renewingUrl: string
  /* Moved by the cases rather than waited for real time: the staleness the renewal hangs on is an hour. */
  let clock: Date

  beforeEach(async () => {
    clock = new Date()
    renewing = createApp({
      db,
      coverDir,
      startBackgroundWork: false,
      signIn: { providers: [devProvider('a-returning-developer')], publicOrigin: '' },
      now: () => clock,
    })
    renewingServer = renewing.listen(0)
    await new Promise<void>((resolve) => renewingServer.once('listening', resolve))
    renewingUrl = `http://127.0.0.1:${(renewingServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await renewing.settled()
    await new Promise<void>((resolve) => { renewingServer.close(() => resolve()) })
  })

  /**
   * `Expires` is dropped since it is expected to change on renewal; `Max-Age`
   * is kept because it should stay the same thirty days counted afresh.
   */
  const keptFrom = (header: string | null) => {
    const said = (header ?? '')
      .split(/,(?=[^;]+=)/)
      .map((one) => one.trim())
      .find((one) => one.startsWith(`${SESSION_COOKIE}=`)) ?? ''
    return said
      .split(';')
      .map((part) => part.trim())
      .filter((part) => !/^expires=/i.test(part))
  }

  const signIn = async () => {
    const back = await fetch(`${renewingUrl}/api/auth/dev/start`, { redirect: 'manual' })
    expect(back.status).toBe(302)
    return back.headers.get('set-cookie')
  }

  it('says nothing at all while the session is fresh', async () => {
    const admitted = cookieIn(await signIn(), SESSION_COOKIE)

    const soon = await fetch(`${renewingUrl}/api/health`, { headers: { cookie: admitted } })

    expect(soon.status).toBe(200)
    /* Re-issuing a `Set-Cookie` on every request would add one to every response in a scan run; staleness is what avoids that. */
    expect(soon.headers.get('set-cookie')).toBeNull()
  })

  it('hands back the very same cookie, thirty days on, once the row goes stale', async () => {
    const written = await signIn()
    const admitted = cookieIn(written, SESSION_COOKIE)

    clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000)
    const later = await fetch(`${renewingUrl}/api/health`, { headers: { cookie: admitted } })

    expect(later.status).toBe(200)
    // The same credential, addressing the same row: a renewal that minted a new
    // token would strand every request already in flight carrying the old one.
    expect(cookieIn(later.headers.get('set-cookie'), SESSION_COOKIE)).toBe(admitted)
    expect(keptFrom(later.headers.get('set-cookie'))).toEqual(keptFrom(written))
  })

  /**
   * Checked via `Max-Age`, not `Expires`: Express computes `Expires` from the
   * real clock while the row's `expires_at` comes from the injected `clock`, so
   * under a fake clock the two would differ by an artifact of this file, not a defect.
   */
  it('slides the row and the browser by the same thirty days', async () => {
    const admitted = cookieIn(await signIn(), SESSION_COOKIE)
    const digest = createHash('sha256')
      .update(admitted.slice(`${SESSION_COOKIE}=`.length))
      .digest('hex')
    const before = await new AuthStore(db).liveSession(digest, clock)

    clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000)
    const later = await fetch(`${renewingUrl}/api/health`, { headers: { cookie: admitted } })
    const after = await new AuthStore(db).liveSession(digest, clock)

    expect(before?.expires_at).toBeTruthy()
    // Both are ISO 8601 in UTC, which sorts as text, and that is how every `_at`
    // column in this schema is spelled.
    expect((after?.expires_at ?? '') > (before?.expires_at ?? '')).toBe(true)
    expect(keptFrom(later.headers.get('set-cookie')))
      .toContain(`Max-Age=${SESSION_DAYS * 24 * 60 * 60}`)
  })
})

/**
 * A process that exits naming a missing variable is recoverable in one
 * command; a misconfigured door left open is not obviously anything.
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
   * Prevents a deployment that has configured Google from also carrying the
   * development door, the moment somebody would otherwise leave it on.
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
