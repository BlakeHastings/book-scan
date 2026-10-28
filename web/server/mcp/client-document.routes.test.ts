/**
 * A client that names itself with a Client ID Metadata Document, the way
 * claude.ai's "Use Claude's published identity" and Claude Code do, driven
 * end to end by the SDK's own client against a real Postgres. The document is
 * served by a local https server that counts every connection, so the tests
 * that say nothing was fetched are proved by a count, not inferred.
 */

import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { removeScratchRoot, scratchRoot } from '../scratchdir'
import { closeTestDatabase, openTestDatabase } from '../testdb'
import type { Db } from '../driver'
import { createApp, type BookScanApp } from '../index'
import { devProvider } from '../auth/providers'
import { signedIn } from '../testauth'
import { isSpecialUse, type DocumentFetchOptions } from './client-document'
import {
  approveIn as approveInAt, CALLBACK, connect as connectAt, consentTokenIn, mcpUrl as mcpUrlOf,
  newClient, RememberingClient,
} from './testclient'
import { json, reaching, startDocumentServer, type DocumentServer } from './testdocument'

let db: Db
let scratch: string
let coverDir: string
let documents: DocumentServer
let app: BookScanApp
let server: Server
let origin: string
let clock: number

const exceptLoopback = (address: string) => address !== '127.0.0.1' && isSpecialUse(address)

async function boot(clientDocuments: DocumentFetchOptions): Promise<void> {
  server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = createApp({
    db,
    coverDir,
    startBackgroundWork: false,
    signIn: { providers: [devProvider('cimd-tester')], publicOrigin: origin },
    now: () => new Date(clock),
    clientDocuments,
  })
  server.on('request', app)
}

async function shutDown(): Promise<void> {
  await app.settled()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

beforeAll(async () => {
  scratch = scratchRoot('mcp-cimd')
  documents = await startDocumentServer(scratch)
})

beforeEach(async () => {
  db = await openTestDatabase()
  coverDir = mkdtempSync(join(scratch, 'covers-'))
  clock = Date.now()
  documents.answers.clear()
  documents.requests.length = 0
  documents.connections = 0
})

afterEach(async () => {
  await shutDown()
  rmSync(coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await documents.close()
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

const documentId = () => `${documents.origin}/oauth/client-metadata`

/** The shape of Claude Code's own published document, at the test server's address. */
function publish(overrides: Record<string, unknown> = {}, cacheControl?: string): void {
  documents.answers.set('/oauth/client-metadata', json({
    client_id: documentId(),
    client_name: 'Claude Code',
    client_uri: 'https://claude.ai',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...overrides,
  }, cacheControl))
}

/** An MCP client that has a published identity, as Claude does. */
class PublishedClient extends RememberingClient {
  get clientMetadataUrl(): string {
    return documentId()
  }
}

/** An authorization request by hand, for the refusals the SDK client would not make. */
function authorizeUrl(params: Record<string, string> = {}): string {
  return `${origin}/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: documentId(),
    redirect_uri: CALLBACK,
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 's1',
    ...params,
  }).toString()}`
}

async function whoami(client: Client): Promise<{ id: string }> {
  const result = await client.callTool({ name: 'whoami', arguments: {} })
  return result.structuredContent as { id: string }
}

async function clientRows(): Promise<{ client_id: string }[]> {
  return db.all<{ client_id: string }>('SELECT client_id FROM oauth_client ORDER BY client_id')
}

describe('a client with a published identity', () => {
  it('is told the server takes one, and connects with it end to end without registering', async () => {
    await boot(reaching(documents, exceptLoopback))
    publish()
    const person = await signedIn(db, { email: 'reader@example.test' })

    const metadata = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json()
    expect(metadata).toMatchObject({
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
    })

    const remembered = new PublishedClient()
    const transport = new StreamableHTTPClientTransport(mcpUrlOf(origin), { authProvider: remembered })
    await expect(newClient().connect(transport)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(remembered.info?.client_id).toBe(documentId())
    expect(remembered.sentTo?.searchParams.get('client_id')).toBe(documentId())

    // The consent page names the client by what its document says and by where the document is.
    const page = await fetch(remembered.sentTo!, { headers: { cookie: person.cookie }, redirect: 'manual' })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Allow Claude Code to use this catalogue as you?')
    expect(html).toContain(`a document at <span class="where">${new URL(documentId()).host}</span>`)
    expect(html).toContain('localhost:7777')
    expect(consentTokenIn(html)).toBeTruthy()

    const code = await approveInAt(origin, person.cookie, remembered.sentTo!)
    await transport.finishAuth(code)
    const client = newClient()
    await client.connect(new StreamableHTTPClientTransport(mcpUrlOf(origin), { authProvider: remembered }))
    expect((await whoami(client)).id).toBe(person.userId)

    // A refresh, and then the connection is listed under the document's name.
    expect(await auth(remembered, { serverUrl: mcpUrlOf(origin) })).toBe('AUTHORIZED')
    expect((await whoami(client)).id).toBe(person.userId)
    const listed = await (await fetch(`${origin}/api/mcp/connections`, { headers: { cookie: person.cookie } })).json()
    expect(listed.connections).toMatchObject([{ client: { id: documentId(), name: 'Claude Code' } }])

    // Nothing was registered, and the document was fetched exactly once for all of that.
    expect(await clientRows()).toEqual([{ client_id: documentId() }])
    expect(documents.requests.map((one) => one.path)).toEqual(['/oauth/client-metadata'])
  })

  it('sends a stranger to sign in without fetching anything, naming the client by its host', async () => {
    await boot(reaching(documents, exceptLoopback))
    publish()
    const page = await fetch(authorizeUrl(), { redirect: 'manual' })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain(`Sign in to connect the client at ${new URL(documentId()).host}`)
    const start = /href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&') ?? ''
    expect(decodeURIComponent(start)).toContain(`client_id=${encodeURIComponent(documentId())}`)

    const waiting = await signedIn(db, { enabled: false })
    const refused = await fetch(authorizeUrl(), { headers: { cookie: waiting.cookie }, redirect: 'manual' })
    expect(refused.status).toBe(403)

    expect(documents.connections).toBe(0)
    expect(await clientRows()).toEqual([])
  })

  it('refuses a document whose client_id is not its own URL, and keeps nothing of it', async () => {
    await boot(reaching(documents, exceptLoopback))
    publish({ client_id: 'https://claude.ai/oauth/claude-code-client-metadata' })
    const person = await signedIn(db)
    const page = await fetch(authorizeUrl(), { headers: { cookie: person.cookie }, redirect: 'manual' })
    expect(page.status).toBe(400)
    expect(await page.json()).toMatchObject({
      error: 'invalid_client',
      error_description: expect.stringContaining('different client_id'),
    })
    expect(await clientRows()).toEqual([])
  })

  it('refuses a document on a private address before any request is sent', async () => {
    await boot({ resolve: documents.resolveTo('127.0.0.1'), ca: documents.certificate })
    publish()
    const person = await signedIn(db)
    const page = await fetch(authorizeUrl(), { headers: { cookie: person.cookie }, redirect: 'manual' })
    expect(page.status).toBe(400)
    expect((await page.json()).error_description).toContain('resolves to 127.0.0.1')
    expect(documents.connections).toBe(0)
    expect(await clientRows()).toEqual([])
  })

  it('refuses a document that is too big, or too slow', async () => {
    await boot({ ...reaching(documents, exceptLoopback), timeoutMs: 300 })
    const person = await signedIn(db)
    publish({ client_name: 'x'.repeat(6000) })
    const big = await fetch(authorizeUrl(), { headers: { cookie: person.cookie }, redirect: 'manual' })
    expect(big.status).toBe(400)
    expect((await big.json()).error_description).toContain('bytes')

    documents.answers.set('/oauth/client-metadata', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{')
    })
    const slow = await fetch(authorizeUrl(), { headers: { cookie: person.cookie }, redirect: 'manual' })
    expect(slow.status).toBe(400)
    expect((await slow.json()).error_description).toContain('longer than')
    expect(await clientRows()).toEqual([])
  })

  it('takes the document\'s redirect URIs as the registered list', async () => {
    await boot(reaching(documents, exceptLoopback))
    publish()
    const person = await signedIn(db)
    const elsewhere = await fetch(authorizeUrl({ redirect_uri: 'https://evil.test/callback' }), {
      headers: { cookie: person.cookie }, redirect: 'manual',
    })
    expect(elsewhere.status).toBe(400)
    expect(await elsewhere.json()).toMatchObject({ error: 'invalid_request', error_description: 'Unregistered redirect_uri' })
  })

  it('reuses a document while it is fresh, fetches it again after, and never fetches at /token', async () => {
    await boot(reaching(documents, exceptLoopback))
    publish({}, 'public, max-age=60')
    const person = await signedIn(db)
    const remembered = new PublishedClient()
    const transport = new StreamableHTTPClientTransport(mcpUrlOf(origin), { authProvider: remembered })
    await expect(newClient().connect(transport)).rejects.toBeInstanceOf(UnauthorizedError)
    await transport.finishAuth(await approveInAt(origin, person.cookie, remembered.sentTo!))
    expect(documents.requests).toHaveLength(1)

    const again = () => fetch(authorizeUrl(), { headers: { cookie: person.cookie }, redirect: 'manual' })
    expect((await again()).status).toBe(200)
    expect(documents.requests).toHaveLength(1)

    clock += 61_000
    expect((await again()).status).toBe(200)
    expect(documents.requests).toHaveLength(2)

    // The publisher goes away: a new approval is refused, the existing connection keeps working.
    documents.answers.set('/oauth/client-metadata', (_req, res) => { res.writeHead(500).end() })
    clock += 61_000
    expect((await again()).status).toBe(400)
    expect(documents.requests).toHaveLength(3)
    expect(await auth(remembered, { serverUrl: mcpUrlOf(origin) })).toBe('AUTHORIZED')
    const client = newClient()
    await client.connect(new StreamableHTTPClientTransport(mcpUrlOf(origin), { authProvider: remembered }))
    expect((await whoami(client)).id).toBe(person.userId)
    expect(documents.requests).toHaveLength(3)
  })
})

describe('dynamic registration, beside it', () => {
  it('still registers and connects a client that has no published identity', async () => {
    await boot(reaching(documents, exceptLoopback))
    const person = await signedIn(db)
    const { client, remembered } = await connectAt(origin, person.cookie)
    expect(remembered.info?.client_id).toMatch(/^[0-9a-f-]{36}$/)
    expect((await whoami(client)).id).toBe(person.userId)
    expect(documents.connections).toBe(0)
  })

  it('cannot be handed an https URL as the id it registers under', async () => {
    await boot(reaching(documents, exceptLoopback))
    const registered = await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: documentId(), client_name: 'Not Claude', redirect_uris: ['https://evil.test/cb'] }),
    })
    expect(registered.status).toBe(201)
    expect((await registered.json()).client_id).toMatch(/^[0-9a-f-]{36}$/)
    expect((await clientRows()).map((row) => row.client_id)).not.toContain(documentId())
  })

  it('answers an unknown registered id without fetching anything', async () => {
    await boot(reaching(documents, exceptLoopback))
    const person = await signedIn(db)
    const page = await fetch(authorizeUrl({ client_id: '00000000-0000-4000-8000-000000000000' }), {
      headers: { cookie: person.cookie }, redirect: 'manual',
    })
    expect(page.status).toBe(400)
    expect(documents.connections).toBe(0)
  })
})
