/**
 * `enable-user --sign-out` ends every way a person is in (#625): their
 * sessions, and every MCP client they have connected, with the tokens those
 * clients hold. Driven against the booted app, so "revoked" means the access
 * token is refused at `/mcp` and the refresh token at `/token`, not merely that
 * a column was written.
 */

import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { removeScratchRoot, scratchRoot } from '../server/scratchdir'
import { closeTestDatabase, openTestDatabase } from '../server/testdb'
import type { Db } from '../server/driver'
import { createApp, type BookScanApp } from '../server/index'
import { devProvider } from '../server/auth/providers'
import { signedIn, type TestSession } from '../server/testauth'
import { connect, mcpUrl, type RememberingClient } from '../server/mcp/testclient'
import { AuthStore, type UserWithIdentities } from '../infrastructure/auth/auth-store'
import { OAuthStore } from '../infrastructure/auth/oauth-store'
import { signOut } from './enable-user'

let db: Db
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let origin: string
let said: string[]

beforeAll(() => {
  scratch = scratchRoot('enable-user-sign-out')
})

beforeEach(async () => {
  db = await openTestDatabase()
  coverDir = mkdtempSync(join(scratch, 'covers-'))
  server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = createApp({
    db,
    coverDir,
    startBackgroundWork: false,
    signIn: { providers: [devProvider('sign-out-tester')], publicOrigin: origin },
  })
  server.on('request', app)

  said = []
  vi.spyOn(console, 'log').mockImplementation((line) => { said.push(String(line)) })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await app.settled()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  rmSync(coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** A tools/list over plain HTTP, so a refusal is seen as a status. */
function listTools(token: string): Promise<Response> {
  return fetch(mcpUrl(origin), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
}

function refresh(remembered: RememberingClient): Promise<Response> {
  return fetch(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: remembered.info!.client_id,
      refresh_token: remembered.saved!.refresh_token!,
    }).toString(),
  })
}

async function personOf(session: TestSession): Promise<UserWithIdentities> {
  const found = (await new AuthStore(db).everybody()).find((one) => one.id === session.userId)
  if (!found) throw new Error(`no person ${session.userId}`)
  return found
}

describe('signing somebody out', () => {
  it('ends their session and every MCP connection, and leaves somebody else connected', async () => {
    const reader = await signedIn(db, { email: 'reader@example.test' })
    const other = await signedIn(db, { email: 'other@example.test' })
    const { remembered: readers } = await connect(origin, reader.cookie)
    const { remembered: others } = await connect(origin, other.cookie)
    expect((await listTools(readers.saved!.access_token)).status).toBe(200)

    const ended = await signOut(db, await personOf(reader), new Date())

    expect(ended).toEqual({ sessions: 1, connections: 1 })
    expect(said.join('\n')).toContain(`Revoked 1 MCP connection(s) for ${reader.userId}`)

    const auth = new AuthStore(db)
    const oauth = new OAuthStore(db)
    const now = new Date()

    // The session is gone.
    expect(await auth.liveSession(digest(reader.token), now)).toBeUndefined()

    // The grant is revoked, and so is everything issued under it.
    const grants = await db.all<{ revoked_at: string | null }>(
      'select revoked_at from oauth_grant where user_id = ?', [reader.userId])
    expect(grants).toHaveLength(1)
    expect(grants[0]!.revoked_at).not.toBeNull()
    expect(await oauth.connections(reader.userId)).toEqual([])
    expect(await oauth.liveAccess(digest(readers.saved!.access_token), now)).toBeUndefined()
    expect((await listTools(readers.saved!.access_token)).status).toBe(401)
    const refused = await refresh(readers)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'invalid_grant' })

    // Still enabled: this took the credentials, not the admission.
    expect((await auth.byId(reader.userId))?.enabled).toBe(true)

    // Nobody else was touched.
    expect(await auth.liveSession(digest(other.token), now)).toBeTruthy()
    expect(await oauth.connections(other.userId)).toHaveLength(1)
    expect((await listTools(others.saved!.access_token)).status).toBe(200)
    expect((await refresh(others)).status).toBe(200)
  })

  it('also ends a grant whose code was approved and not yet exchanged', async () => {
    const reader = await signedIn(db)
    const oauth = new OAuthStore(db)
    await oauth.registerClient('a-client', JSON.stringify({ client_id: 'a-client' }), new Date())
    await oauth.openGrant({
      id: 'an-unexchanged-grant',
      clientId: 'a-client',
      userId: reader.userId,
      resource: `${origin}/mcp`,
      redirectUri: 'http://localhost:7777/callback',
      codeHash: digest('a-code'),
      codeChallenge: 'challenge',
    }, new Date())

    expect(await signOut(db, await personOf(reader), new Date())).toEqual({ sessions: 1, connections: 1 })
    expect(await oauth.challengeFor(digest('a-code'), 'a-client', new Date())).toBeUndefined()
  })

  it('says there was nothing to revoke for somebody with no client connected', async () => {
    const reader = await signedIn(db)

    expect(await signOut(db, await personOf(reader), new Date())).toEqual({ sessions: 1, connections: 0 })
    expect(said.join('\n')).toContain('has no MCP client connected, so there was nothing to revoke')
  })

  it('ends nothing when the connections cannot be revoked, because it is one transaction', async () => {
    const reader = await signedIn(db)
    vi.spyOn(OAuthStore.prototype, 'revokeEveryGrantOf').mockRejectedValue(new Error('the second half failed'))

    await expect(signOut(db, await personOf(reader), new Date())).rejects.toThrow('the second half failed')
    expect(await new AuthStore(db).liveSession(digest(reader.token), new Date())).toBeTruthy()
  })
})
