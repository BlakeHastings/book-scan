/**
 * The MCP connector driven by the SDK's own client, the way claude.ai or Claude
 * Code drives it: discovery from a `401`, dynamic registration, the browser
 * half (sign in, consent), the code exchange, a tool call, a refresh and a
 * revocation. The browser half is `fetch` carrying a session cookie made the
 * way the other `*.routes.test.ts` files make one.
 *
 * The app is listened on before it is built, because the issuer and the
 * resource are absolute URLs from configuration and the SDK client checks the
 * resource it is told about against the URL it connected to.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { auth, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

import { removeScratchRoot, scratchRoot } from '../scratchdir'
import { closeTestDatabase, openTestDatabase } from '../testdb'
import type { Db } from '../driver'
import { createApp, type BookScanApp } from '../index'
import { devProvider } from '../auth/providers'
import { signedIn } from '../testauth'
import { AuthStore } from '../../infrastructure/auth/auth-store'

let db: Db
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let origin: string

const CALLBACK = 'http://localhost:7777/callback'

beforeAll(() => {
  scratch = scratchRoot('mcp-connector')
})

async function boot(options: { clientDir?: string } = {}): Promise<void> {
  server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = createApp({
    db,
    coverDir,
    startBackgroundWork: false,
    clientDir: options.clientDir,
    signIn: { providers: [devProvider('mcp-tester')], publicOrigin: origin },
  })
  server.on('request', app)
}

async function shutDown(): Promise<void> {
  await app.settled()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

beforeEach(async () => {
  db = await openTestDatabase()
  coverDir = mkdtempSync(join(scratch, 'covers-'))
  await boot()
})

afterEach(async () => {
  await shutDown()
  rmSync(coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

/** What an MCP client keeps between runs, in memory. */
class RememberingClient implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined
  saved: OAuthTokens | undefined
  verifier = ''
  sentTo: URL | undefined

  get redirectUrl(): string {
    return CALLBACK
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'A test client',
      redirect_uris: [CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  clientInformation() { return this.info }
  saveClientInformation(info: OAuthClientInformationMixed) { this.info = info }
  tokens() { return this.saved }
  saveTokens(tokens: OAuthTokens) { this.saved = tokens }
  redirectToAuthorization(url: URL) { this.sentTo = url }
  saveCodeVerifier(verifier: string) { this.verifier = verifier }
  codeVerifier() { return this.verifier }
}

const mcpUrl = () => new URL('/mcp', origin)

function newClient(): Client {
  return new Client({ name: 'connector-test', version: '0.0.0' })
}

/** The consent page's hidden token, out of the HTML this server drew. */
function consentTokenIn(html: string): string {
  const found = /name="consent" value="([^"]+)"/.exec(html)?.[1]
  if (!found) throw new Error(`no consent form on this page:\n${html}`)
  return found
}

/** Answer a consent page as a browser would, and say where it was sent. */
async function answer(token: string, cookie: string, decision: 'approve' | 'deny'): Promise<Response> {
  return fetch(`${origin}/api/mcp/consent`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ consent: token, decision }).toString(),
  })
}

/** The browser half: open the authorization URL signed in, and approve. */
async function approveIn(browserCookie: string, authorizationUrl: URL): Promise<string> {
  const page = await fetch(authorizationUrl, { headers: { cookie: browserCookie }, redirect: 'manual' })
  expect(page.status).toBe(200)
  const back = await answer(consentTokenIn(await page.text()), browserCookie, 'approve')
  expect(back.status).toBe(302)
  const location = new URL(back.headers.get('location') ?? '')
  expect(`${location.origin}${location.pathname}`).toBe(CALLBACK)
  return location.searchParams.get('code') ?? ''
}

/** A connected SDK client, through the whole flow, as the person behind `cookie`. */
async function connect(cookie: string): Promise<{ client: Client; remembered: RememberingClient; code: string }> {
  const remembered = new RememberingClient()
  const first = newClient()
  const transport = new StreamableHTTPClientTransport(mcpUrl(), { authProvider: remembered })
  await expect(first.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError)
  expect(remembered.info?.client_id).toBeTruthy()
  expect(remembered.sentTo).toBeDefined()

  const code = await approveIn(cookie, remembered.sentTo!)
  await transport.finishAuth(code)

  const client = newClient()
  await client.connect(new StreamableHTTPClientTransport(mcpUrl(), { authProvider: remembered }))
  return { client, remembered, code }
}

async function whoami(client: Client): Promise<{ id: string; email: string }> {
  const result = await client.callTool({ name: 'whoami', arguments: {} })
  return result.structuredContent as { id: string; email: string }
}

const bearer = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
})

/** A tools/list over plain HTTP, so a refusal is seen as a status rather than through the SDK. */
function listTools(token: string): Promise<Response> {
  return fetch(mcpUrl(), {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
}

describe('the SDK client, through the whole flow', () => {
  it('registers, is approved, exchanges, calls whoami as the person, refreshes and is revoked', async () => {
    const person = await signedIn(db, { email: 'reader@example.test' })
    const { client, remembered } = await connect(person.cookie)

    // Registered public, whatever it asked for: no secret exists to store.
    expect(remembered.info).toMatchObject({ token_endpoint_auth_method: 'none' })
    expect((remembered.info as { client_secret?: string }).client_secret).toBeUndefined()

    const me = await whoami(client)
    expect(me).toMatchObject({ id: person.userId, email: 'reader@example.test' })

    // Refresh, through the SDK, rotates both tokens.
    const before = remembered.saved!
    expect(before.refresh_token).toBeTruthy()
    expect(await auth(remembered, { serverUrl: mcpUrl() })).toBe('AUTHORIZED')
    const after = remembered.saved!
    expect(after.access_token).not.toBe(before.access_token)
    expect(after.refresh_token).not.toBe(before.refresh_token)
    expect((await whoami(client)).id).toBe(person.userId)

    // The token stored is a digest, never the token.
    const rows = await db.all<{ token_hash: string }>('SELECT token_hash FROM oauth_token')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.token_hash).not.toBe(after.access_token)
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(rows.map((row) => row.token_hash))
      .toContain(createHash('sha256').update(after.access_token).digest('hex'))

    // Revoked, by the client, as RFC 7009 has it.
    const revoked = await fetch(`${origin}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: remembered.info!.client_id, token: after.refresh_token! }).toString(),
    })
    expect(revoked.status).toBe(200)

    const refused = await listTools(after.access_token)
    expect(refused.status).toBe(401)
    expect(refused.headers.get('www-authenticate')).toContain('resource_metadata=')
    await expect(whoami(client)).rejects.toThrow()
  })

  it('stops answering a person who is disabled, on the next call, and answers them again once let back in', async () => {
    const person = await signedIn(db)
    const { client, remembered } = await connect(person.cookie)
    expect((await whoami(client)).id).toBe(person.userId)

    await new AuthStore(db).setEnabled(person.userId, false, new Date())
    const refused = await listTools(remembered.saved!.access_token)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ state: 'waiting' })
    await expect(whoami(client)).rejects.toThrow()

    await new AuthStore(db).setEnabled(person.userId, true, new Date())
    expect((await listTools(remembered.saved!.access_token)).status).toBe(200)
  })

  it('reuses the existing sign-in for somebody who arrives with no session', async () => {
    const remembered = new RememberingClient()
    const transport = new StreamableHTTPClientTransport(mcpUrl(), { authProvider: remembered })
    await expect(newClient().connect(transport)).rejects.toBeInstanceOf(UnauthorizedError)

    const page = await fetch(remembered.sentTo!, { redirect: 'manual' })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Sign in to connect A test client')
    const start = /href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&') ?? ''
    expect(start.startsWith('/api/auth/dev/start?next=')).toBe(true)

    // The development door signs in and sends the browser back to the same request.
    const signIn = await fetch(`${origin}${start}`, { redirect: 'manual' })
    expect(signIn.status).toBe(302)
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0]
    const back = new URL(signIn.headers.get('location') ?? '', origin)
    expect(back.pathname).toBe('/authorize')

    const code = await approveIn(cookie, back)
    await transport.finishAuth(code)
    const client = newClient()
    await client.connect(new StreamableHTTPClientTransport(mcpUrl(), { authProvider: remembered }))
    expect((await whoami(client)).id).toBeTruthy()
  })
})

/** A client registered by hand, a PKCE pair, and an approved code. */
async function rawCode(cookie: string, options: { resource?: string } = {}) {
  const registered = await fetch(`${origin}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'By hand', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }),
  })
  expect(registered.status).toBe(201)
  const { client_id: clientId } = await registered.json() as { client_id: string }

  const verifier = randomBytes(32).toString('base64url')
  const url = new URL('/authorize', origin)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'a-state',
    resource: options.resource ?? `${origin}/mcp`,
  }).toString()
  return { clientId, verifier, url }
}

function exchange(clientId: string, code: string, verifier: string): Promise<Response> {
  return fetch(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      resource: `${origin}/mcp`,
    }).toString(),
  })
}

describe('the refusals the token endpoint owes', () => {
  it('refuses a code presented twice, and revokes what the first exchange issued', async () => {
    const person = await signedIn(db)
    const { clientId, verifier, url } = await rawCode(person.cookie)
    const code = await approveIn(person.cookie, url)

    const first = await exchange(clientId, code, verifier)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const tokens = await first.json() as OAuthTokens
    expect((await listTools(tokens.access_token)).status).toBe(200)

    const second = await exchange(clientId, code, verifier)
    expect(second.status).toBe(400)
    expect(await second.json()).toMatchObject({ error: 'invalid_grant' })

    expect((await listTools(tokens.access_token)).status).toBe(401)
  })

  it('refuses a verifier that does not match the challenge', async () => {
    const person = await signedIn(db)
    const { clientId, url } = await rawCode(person.cookie)
    const code = await approveIn(person.cookie, url)

    const wrong = await exchange(clientId, code, randomBytes(32).toString('base64url'))
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('refuses a refresh token used twice, and ends the connection', async () => {
    const person = await signedIn(db)
    const { clientId, verifier, url } = await rawCode(person.cookie)
    const tokens = await (await exchange(clientId, await approveIn(person.cookie, url), verifier)).json() as OAuthTokens

    const refresh = () => fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token! }).toString(),
    })
    const once = await refresh()
    expect(once.status).toBe(200)
    const rotated = await once.json() as OAuthTokens

    const twice = await refresh()
    expect(twice.status).toBe(400)
    expect(await twice.json()).toMatchObject({ error: 'invalid_grant' })
    expect((await listTools(rotated.access_token)).status).toBe(401)
  })

  it('refuses to authorize a token for any resource but its own /mcp', async () => {
    const person = await signedIn(db)
    const { url } = await rawCode(person.cookie, { resource: 'https://another-server.example/mcp' })
    const answered = await fetch(url, { headers: { cookie: person.cookie }, redirect: 'manual' })
    expect(answered.status).toBe(302)
    const back = new URL(answered.headers.get('location') ?? '')
    expect(back.searchParams.get('error')).toBe('invalid_target')
    expect(back.searchParams.get('state')).toBe('a-state')
  })
})

describe('the browser half', () => {
  it('answers a person who is not let in with the waiting page, and no code', async () => {
    const waiting = await signedIn(db, { enabled: false })
    const { url } = await rawCode(waiting.cookie)
    const page = await fetch(url, { headers: { cookie: waiting.cookie }, redirect: 'manual' })
    expect(page.status).toBe(403)
    expect(await page.text()).not.toContain('name="consent"')
  })

  it('sends a denial back to the client as access_denied', async () => {
    const person = await signedIn(db)
    const { url } = await rawCode(person.cookie)
    const page = await (await fetch(url, { headers: { cookie: person.cookie } })).text()
    const back = await answer(consentTokenIn(page), person.cookie, 'deny')
    const location = new URL(back.headers.get('location') ?? '')
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('code')).toBeNull()
  })

  it('refuses an approval posted from a session the page was not drawn for', async () => {
    const person = await signedIn(db)
    const somebodyElse = await signedIn(db)
    const { url } = await rawCode(person.cookie)
    const token = consentTokenIn(await (await fetch(url, { headers: { cookie: person.cookie } })).text())

    expect((await answer(token, '', 'approve')).status).toBe(401)
    expect((await answer(token, somebodyElse.cookie, 'approve')).status).toBe(400)
    // And it was spent by that attempt, so the right session cannot reuse a token somebody else tried.
    expect((await answer(token, person.cookie, 'approve')).status).toBe(400)
  })

  it('draws the consent page so it cannot be framed, and names where the answer goes', async () => {
    const person = await signedIn(db)
    const { url } = await rawCode(person.cookie)
    const page = await fetch(url, { headers: { cookie: person.cookie } })
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(await page.text()).toContain('localhost:7777')
  })
})

describe('what each door accepts', () => {
  it('answers /mcp with no token 401, pointing at the protected-resource metadata', async () => {
    const response = await fetch(mcpUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate'))
      .toContain(`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const metadata = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`)
    expect(metadata.headers.get('cache-control')).toBe('no-store')
    expect(await metadata.json()).toMatchObject({ resource: `${origin}/mcp`, authorization_servers: [`${origin}/`] })
  })

  it('does not take a session cookie as a bearer at /mcp', async () => {
    const person = await signedIn(db)
    const response = await fetch(mcpUrl(), {
      method: 'POST',
      headers: { cookie: person.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(response.status).toBe(401)
  })

  it('does not take a bearer token as a session under /api', async () => {
    const person = await signedIn(db)
    const { clientId, verifier, url } = await rawCode(person.cookie)
    const tokens = await (await exchange(clientId, await approveIn(person.cookie, url), verifier)).json() as OAuthTokens
    expect((await fetch(`${origin}/api/health`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401)
  })

  it('refuses to register a redirect that is neither https nor loopback', async () => {
    const response = await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Plain http', redirect_uris: ['http://attacker.example/cb'] }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' })
  })

  it('says in its metadata that every client is public and PKCE is S256', async () => {
    const response = await fetch(`${origin}/.well-known/oauth-authorization-server`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      issuer: `${origin}/`,
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      registration_endpoint: `${origin}/register`,
    })
  })
})

describe('a person and their connections', () => {
  it('lists what they connected and disconnects one, which ends its tokens', async () => {
    const person = await signedIn(db)
    const other = await signedIn(db)
    const { remembered } = await connect(person.cookie)

    const listed = await (await fetch(`${origin}/api/mcp/connections`, { headers: { cookie: person.cookie } })).json() as {
      connections: { id: string; client: { name: string }; redirectHost: string }[]
    }
    expect(listed.connections).toHaveLength(1)
    expect(listed.connections[0]).toMatchObject({ client: { name: 'A test client' }, redirectHost: 'localhost:7777' })

    const id = listed.connections[0].id
    // Somebody else cannot disconnect it, and is told nothing about it.
    expect((await fetch(`${origin}/api/mcp/connections/${id}`, { method: 'DELETE', headers: { cookie: other.cookie } })).status).toBe(404)
    expect((await fetch(`${origin}/api/mcp/connections/${id}`, { method: 'DELETE', headers: { cookie: person.cookie } })).status).toBe(204)
    expect((await listTools(remembered.saved!.access_token)).status).toBe(401)
  })
})

describe('beside a built client', () => {
  it('answers the connector doors itself, never with the single-page fallback', async () => {
    await shutDown()
    const clientDir = mkdtempSync(join(scratch, 'client-'))
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>the client</title>')
    await boot({ clientDir })

    const mcp = await fetch(mcpUrl())
    expect(mcp.status).toBe(401)
    expect(await mcp.text()).not.toContain('the client')

    const authorize = await fetch(`${origin}/authorize`)
    expect(authorize.status).toBe(400)
    expect(await authorize.text()).not.toContain('the client')

    // And a path nobody registered is still the client's.
    expect(await (await fetch(`${origin}/library`)).text()).toContain('the client')
    rmSync(clientDir, { recursive: true, force: true })
  })
})
