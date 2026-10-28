/**
 * Whose address the MCP connector's rate limits count against, behind a proxy.
 *
 * `/register` allows twenty registrations an hour per address, which is the
 * SDK's limit and the one this issue was about. Each request here comes from
 * the test's own socket, which plays the proxy, and carries the
 * `X-Forwarded-For` that proxy would have written: the address it received the
 * request from, appended to whatever the client sent.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { createApp, type BookScanApp } from './index'
import { devProvider } from './auth/providers'

const REGISTRATIONS_AN_HOUR = 20

let db: Db
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let origin: string

beforeAll(() => {
  scratch = scratchRoot('trust-proxy')
})

beforeEach(async () => {
  db = await openTestDatabase()
  coverDir = mkdtempSync(join(scratch, 'covers-'))
})

afterEach(async () => {
  await app.settled()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  rmSync(coverDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

async function boot(proxyHops: number | undefined): Promise<void> {
  server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = createApp({
    db,
    coverDir,
    startBackgroundWork: false,
    signIn: { providers: [devProvider('proxy-tester')], publicOrigin: origin },
    proxyHops,
  })
  server.on('request', app)
}

/** One registration, carrying the `X-Forwarded-For` the proxy in front wrote. */
async function register(forwardedFor: string): Promise<number> {
  const answer = await fetch(new URL('/register', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ redirect_uris: ['http://localhost:7777/callback'], client_name: 'a client' }),
  })
  await answer.arrayBuffer()
  return answer.status
}

/** Spend one address's whole hour, checking every one of them was let through. */
async function exhaust(forwardedFor: (n: number) => string): Promise<void> {
  for (let n = 0; n < REGISTRATIONS_AN_HOUR; n++) {
    expect(await register(forwardedFor(n))).toBe(201)
  }
}

const A_STRANGER = '203.0.113.7'
const SOMEBODY_ELSE = '198.51.100.23'

describe('behind one proxy', () => {
  it('gives two clients two rate limits when the deployment trusts one hop', async () => {
    await boot(1)
    await exhaust(() => A_STRANGER)

    expect(await register(A_STRANGER)).toBe(429)
    expect(await register(SOMEBODY_ELSE)).toBe(201)
  })

  it('gives every client the proxy\'s one rate limit when it trusts none, which is the defect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await boot(0)
    await exhaust(() => A_STRANGER)

    expect(await register(SOMEBODY_ELSE)).toBe(429)
  })

  it('trusts none when nothing says otherwise, which is every checkout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await boot(undefined)
    await exhaust(() => A_STRANGER)

    expect(await register(SOMEBODY_ELSE)).toBe(429)
  })

  /*
   * The client writes everything to the left of what the proxy appended, so
   * here it sends a different invented address on every request. Counting one
   * hop from the right never reaches what it wrote.
   */
  it('does not let a client choose its own rate limit by sending X-Forwarded-For itself', async () => {
    await boot(1)
    await exhaust((n) => `10.0.0.${n}, ${A_STRANGER}`)

    expect(await register(`10.9.9.9, ${A_STRANGER}`)).toBe(429)
    expect(await register(`${SOMEBODY_ELSE}, ${A_STRANGER}`)).toBe(429)
    expect(await register(SOMEBODY_ELSE)).toBe(201)
  })

  /*
   * express-rate-limit says so when it sees the header and trusts nothing,
   * and only when the setting is exactly `false`, which is why zero is handed
   * to Express as `false` rather than as 0.
   */
  it('lets express-rate-limit say a proxy is being ignored when it trusts none', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    await boot(0)
    await register(A_STRANGER)

    expect(said.mock.calls.flat().map(String).join('\n')).toContain('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')
  })

  it('and says nothing of the kind when it trusts one', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    await boot(1)
    await register(A_STRANGER)

    expect(said.mock.calls.flat().map(String).join('\n')).not.toContain('ERR_ERL_')
  })
})

describe('behind a CDN in front of a reverse proxy', () => {
  /*
   * The CDN appends the client, the reverse proxy appends the CDN's edge, and
   * the socket is the reverse proxy: two hops. The edge address is the same
   * for many clients, which is exactly what a count of one would key on.
   */
  const EDGE = '192.0.2.50'

  it('gives each client its own rate limit at two hops, whatever the client sent in front', async () => {
    await boot(2)
    await exhaust((n) => `10.0.0.${n}, ${A_STRANGER}, ${EDGE}`)

    expect(await register(`10.9.9.9, ${A_STRANGER}, ${EDGE}`)).toBe(429)
    expect(await register(`${SOMEBODY_ELSE}, ${EDGE}`)).toBe(201)
  })

  it('puts every client behind the edge at one hop, which is why it has to be counted', async () => {
    await boot(1)
    await exhaust(() => `${A_STRANGER}, ${EDGE}`)

    expect(await register(`${SOMEBODY_ELSE}, ${EDGE}`)).toBe(429)
  })
})
