/**
 * Walks the app's own router stack and counts, rather than asserting a list
 * of paths: a list only proves the doors somebody thought of, and would stay
 * green while a new one was added unprotected. It finds the gate by name,
 * counts what is registered before and after it, and fails if anything but
 * the five open doors is above the line.
 *
 * The numbers it prints match `docs/the-gate.md`; if they disagree, the
 * document is wrong.
 *
 * The stack shows where a check is mounted but not what it answers, so the
 * three refusal states are also driven over real HTTP against a real
 * Postgres, on the harness the other `*.routes.test.ts` files use.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type express from 'express'
import pg from 'pg'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { AuthStore } from '../infrastructure/auth/auth-store'
import { PgDb } from './db.pg'
import { createApp, type BookScanApp } from './index'
import { signedIn } from './testauth'
import { OPEN_DOORS } from './auth/gate'
import { SESSION_COOKIE } from '../shared/auth'

let pool: pg.Pool
let db: PgDb
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let baseUrl: string

/** A known photograph on disk, so a request for one is a request for a file. */
const COVER = 'gate-521-known.jpg'

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('gate-routes')
})

beforeEach(async () => {
  coverDir = mkdtempSync(join(scratch, 'covers-'))
  writeFileSync(
    join(coverDir, COVER),
    // Wider than the largest thumbnail width the route offers, because the
    // resize is `withoutEnlargement` and a small fixture would come back at its
    // own size and prove nothing about the resize having happened.
    await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#333' } })
      .jpeg().toBuffer(),
  )
  app = createApp({ db, coverDir, startBackgroundWork: false })
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

afterAll(async () => {
  await closeScratchDatabases()
  removeScratchRoot(scratch)
})

/**
 * `app._router` is not part of Express's public surface; reading it here is
 * a deliberate trade against a list of paths, which could not catch a route
 * added later. If this shape ever changes, `stackOf` fails loudly with
 * nothing found rather than passing while counting nothing.
 */
interface Layer {
  name: string
  route?: { path: string; methods: Record<string, boolean> }
}

function stackOf(built: express.Express): Layer[] {
  const router = (built as unknown as { _router?: { stack?: Layer[] } })._router
  const stack = router?.stack
  if (!stack?.length) {
    throw new Error(
      "Express's router stack is not where this file expects it. Nothing below " +
      'counts anything, so this is a failure rather than a pass.',
    )
  }
  return stack
}

/** `GET /api/books`, the way `OPEN_DOORS` spells a door. */
function named(layer: Layer): string[] {
  if (!layer.route) return []
  return Object.keys(layer.route.methods)
    .filter((method) => method !== '_all')
    .map((method) => `${method.toUpperCase()} ${layer.route!.path}`)
}

/** Where the gate sits in the stack. */
function gateAt(stack: Layer[]): number {
  const at = stack.findIndex((layer) => layer.name === 'gate')
  if (at < 0) throw new Error('there is no layer called `gate` in this app at all')
  return at
}

describe('the count', () => {
  it('has exactly five doors in front of the gate, and they are the five named ones', () => {
    const stack = stackOf(app)
    const before = stack.slice(0, gateAt(stack)).flatMap(named)

    expect(before).toEqual([...OPEN_DOORS])
  })

  it('has every one of the seventy-three handlers behind it', () => {
    const stack = stackOf(app)
    const behind = stack.slice(gateAt(stack) + 1).flatMap(named)

    /*
     * If this number moves, a route was added or removed, and the question
     * to answer is which, not to edit the number until it is green.
     */
    expect(behind).toHaveLength(73)
    expect(behind).toContain('POST /api/tags')
    expect(behind).toContain('DELETE /api/tags')

    // And every one of them is under /api, which is what makes the mount
    // above cover them. A handler registered on any other path would be
    // reachable without a session and this is what would say so.
    for (const door of behind) expect(door, door).toMatch(/^[A-Z]+ \/api(\/|$)/)
  })

  it('has the photographs behind it, mount and all', () => {
    const stack = stackOf(app)
    const behind = stack.slice(gateAt(stack) + 1)

    // The thumbnail route, which is a route layer.
    expect(behind.flatMap(named)).toContain('GET /api/covers/:name')
    // And the static mount, which is not a route layer: it is
    // `express.static`, recorded under the name of its own handler.
    expect(behind.some((layer) => layer.name === 'serveStatic')).toBe(true)
    expect(stack.slice(0, gateAt(stack)).some((layer) => layer.name === 'serveStatic')).toBe(false)
  })

  it('has nothing but the body parser and the five doors above it', () => {
    const stack = stackOf(app)
    const above = stack.slice(0, gateAt(stack))

    /*
     * `query` and `expressInit` are Express's own head-of-stack middleware.
     * `jsonParser` is `express.json`, and `apiCache` sets one cache header
     * and calls `next`; it sits above the gate deliberately, since the two
     * refusals are answers about a person too.
     *
     * Asserted as an exact list rather than filtered, since the failure this
     * guards against is somebody mounting something new above the gate, and
     * a check that allowed "middleware in general" would allow exactly that.
     */
    const notRoutes = above.filter((layer) => !layer.route).map((layer) => layer.name)
    expect(notRoutes).toEqual(['query', 'expressInit', 'jsonParser', 'apiCache'])
  })

})

describe('the three states, asked rather than read', () => {
  const ask = (path: string, cookie = '', init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } })

  it('answers a stranger 401 on a route that writes', async () => {
    const response = await ask('/api/fixtures', '', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A bookcase a stranger made', kind: 'bookcase' }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ state: 'anonymous' })
    /*
     * The header is on the refusal too, because a stored `401` served later
     * to somebody who has since been let in would be the same defect from
     * the other side. `apiCache` sets it and gets out of the way; a
     * middleware here that answered, or failed to call `next`, would turn
     * this refusal into something else.
     */
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('answers a signed-in but not admitted person 403 on the same route', async () => {
    const waiting = await signedIn(db, { enabled: false })
    const response = await ask('/api/fixtures', waiting.cookie, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A bookcase a waiting person made', kind: 'bookcase' }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ state: 'waiting' })
  })

  it('lets an enabled person through to the route itself', async () => {
    const admitted = await signedIn(db)
    const response = await ask('/api/fixtures', admitted.cookie, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A bookcase an admitted person made', kind: 'bookcase' }),
    })

    expect(response.status).toBe(201)
  })

  /**
   * Both cover doors, because they are two: the static mount serves the
   * file and the route beside it re-encodes a smaller copy of the same
   * file, and a gate that covered one and not the other would still hand
   * the collection over, one thumbnail at a time.
   */
  it('refuses a stranger a photograph by name, at both doors', async () => {
    expect((await ask(`/api/covers/${COVER}`)).status).toBe(401)
    expect((await ask(`/api/covers/${COVER}?w=160`)).status).toBe(401)
  })

  it('refuses a person on the waiting list the same photograph, differently', async () => {
    const waiting = await signedIn(db, { enabled: false })
    expect((await ask(`/api/covers/${COVER}`, waiting.cookie)).status).toBe(403)
    expect((await ask(`/api/covers/${COVER}?w=160`, waiting.cookie)).status).toBe(403)
  })

  it('hands an admitted person the photograph, at both doors', async () => {
    const admitted = await signedIn(db)
    const full = await ask(`/api/covers/${COVER}`, admitted.cookie)
    const thumb = await ask(`/api/covers/${COVER}?w=160`, admitted.cookie)

    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toContain('image/jpeg')
    expect(thumb.status).toBe(200)
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(160)
  })

  /**
   * `/api/health` answers the collection's counts and where the database
   * lives, so a stranger is owed none of it. A `401` here still proves the
   * server is up, which is what this asserts alongside the refusal.
   */
  it('refuses a stranger the health endpoint, and still proves the server is up', async () => {
    const response = await ask('/api/health')
    expect(response.status).toBe(401)
    const body = await response.text()
    expect(body).not.toContain('counts')
    expect(body).not.toContain('postgres')
  })

  it('refuses a stranger the backup answer, which is about the collection too', async () => {
    expect((await ask('/api/backup')).status).toBe(401)
  })

  /**
   * The catch-all 404 is behind the gate too: a stranger cannot learn which
   * paths this app answers by asking, because every one of them says the
   * same thing.
   */
  it('does not tell a stranger which /api paths exist', async () => {
    expect((await ask('/api/books')).status).toBe(401)
    expect((await ask('/api/there-is-no-such-route')).status).toBe(401)
  })
})

describe('what a session is, and what stops being one', () => {
  const ask = (path: string, cookie: string) =>
    fetch(`${baseUrl}${path}`, { headers: { cookie } })

  it('is refused once the person is disabled again, on their very next request', async () => {
    const admitted = await signedIn(db)
    expect((await ask('/api/health', admitted.cookie)).status).toBe(200)

    await new AuthStore(db).setEnabled(admitted.userId, false, new Date())

    // No sign-out, no expiry, no sweep. `enabled` is read from `user` on every
    // request rather than cached on the session, which is what lets the enable
    // script be a script that writes one column.
    const after = await ask('/api/health', admitted.cookie)
    expect(after.status).toBe(403)
    expect(await after.json()).toMatchObject({ state: 'waiting' })
  })

  it('is refused once it has been revoked, as a stranger rather than as waiting', async () => {
    const admitted = await signedIn(db)
    expect((await ask('/api/health', admitted.cookie)).status).toBe(200)

    await new AuthStore(db).revokeSessionsFor(admitted.userId, new Date())

    const after = await ask('/api/health', admitted.cookie)
    expect(after.status).toBe(401)
    // And the browser is told to stop sending it, so a revoked cookie does not
    // keep arriving forever.
    expect(after.headers.get('set-cookie') ?? '').toContain(SESSION_COOKIE)
  })

  it('is not a cookie somebody made up', async () => {
    expect((await ask('/api/health', `${SESSION_COOKIE}=not-a-real-token`)).status).toBe(401)
  })

  it('does not leak between people', async () => {
    const one = await signedIn(db)
    const two = await signedIn(db, { enabled: false })

    expect(one.userId).not.toBe(two.userId)
    expect((await ask('/api/health', one.cookie)).status).toBe(200)
    expect((await ask('/api/health', two.cookie)).status).toBe(403)
  })
})
