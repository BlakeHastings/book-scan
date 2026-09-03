/**
 * The count, and the two refusals, over real HTTP (#521).
 *
 * ## Why this file counts rather than describes
 *
 * `docs/auth-surface.md` found seventy-two ways into this app and not one of
 * them locked, and #521's own words about the fix are that "a test proves the
 * door you thought of is locked; the finding is the door you did not". A file
 * that asserted a list of paths would be exactly that: a list of the doors
 * somebody thought of, going green while a seventy-third was added below it.
 *
 * So this walks the app's own router stack and counts. It finds the gate by
 * name, counts what is registered before it and after it, and fails if anything
 * but the five open doors is above the line. A route added tomorrow is behind
 * the gate or this file says which one is not, by path, without anybody
 * updating it.
 *
 * The numbers it prints are the numbers in `docs/the-gate.md`. If they
 * disagree, the document is wrong and this is right.
 *
 * ## And it asks, as well as reading
 *
 * The stack tells you where a check is mounted. It does not tell you what the
 * check answers, and the whole of #510's middle state is about the difference
 * between two refusals. So the three states are driven over HTTP against a real
 * Postgres, on the harness the other `*.routes.test.ts` files use, including on
 * `/api/covers`, which is the door `docs/auth-surface.md` measured answering
 * `200` with the photograph to a stranger.
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
 * Express's router stack, typed as much as it can be.
 *
 * `app._router` is not part of Express's public surface, and reading it here is
 * a deliberate trade: the alternative is a list of paths in this file, which is
 * the thing that cannot catch the route somebody adds next. Express 4 has had
 * this shape for its whole life, and if it ever changes this file fails loudly
 * with nothing found rather than passing while counting nothing.
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
     * Seventy-one was `docs/auth-surface.md`'s count, taken by reading
     * `server/index.ts` one route at a time at commit 3690dc5. If this number
     * moves, a route was added or removed, and the question to answer is which —
     * not to edit the number until it is green.
     *
     * It moved to seventy-three at #452, and the two are `POST /api/tags` and
     * `DELETE /api/tags`: the third door onto naming a tag, which is the one
     * with no book in it, and the sweep that undoes it. Both are ordinary
     * handlers under `/api` registered below the gate with every other one, so
     * they are covered by where they are rather than by anybody remembering, and
     * the loop underneath is what says so.
     */
    expect(behind).toHaveLength(73)
    expect(behind).toContain('POST /api/tags')
    expect(behind).toContain('DELETE /api/tags')

    // And every one of them is under /api, which is what makes the mount above
    // cover them. A handler registered on any other path would be reachable
    // without a session and this is what would say so.
    for (const door of behind) expect(door, door).toMatch(/^[A-Z]+ \/api(\/|$)/)
  })

  it('has the photographs behind it, mount and all', () => {
    const stack = stackOf(app)
    const behind = stack.slice(gateAt(stack) + 1)

    // The thumbnail route, which is a route layer.
    expect(behind.flatMap(named)).toContain('GET /api/covers/:name')
    // And the static mount, which is not: it is `express.static`, which Express
    // records under the name of its own handler. This is door seventy-two.
    expect(behind.some((layer) => layer.name === 'serveStatic')).toBe(true)
    expect(stack.slice(0, gateAt(stack)).some((layer) => layer.name === 'serveStatic')).toBe(false)
  })

  it('has nothing but the body parser and the five doors above it', () => {
    const stack = stackOf(app)
    const above = stack.slice(0, gateAt(stack))

    /*
     * Route layers are the five. Everything else above the gate is middleware
     * that answers nothing, and there are exactly three of them:
     *
     * - `query` and `expressInit`, which Express itself puts at the head of
     *   every app's stack. They parse the query string and set `req.res`.
     * - `jsonParser`, which is `express.json` reading a body.
     *
     * The list is asserted rather than filtered, because the failure this is
     * here for is somebody mounting something above the gate, and a check that
     * allowed "middleware in general" would allow exactly that.
     */
    const notRoutes = above.filter((layer) => !layer.route).map((layer) => layer.name)
    expect(notRoutes).toEqual(['query', 'expressInit', 'jsonParser'])
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

    // 201 is what `docs/auth-surface.md` measured here, from another machine on
    // the network, with no credential of any kind.
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ state: 'anonymous' })
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
   * The one `docs/auth-surface.md` called "the single most important line": an
   * unauthenticated request for a known cover filename answering 200 with the
   * photograph and a thirty day immutable cache header on it.
   *
   * Both cover doors, because they are two: the static mount serves the file
   * and the route beside it re-encodes a smaller copy of the same file, and a
   * gate that covered one and not the other would still hand the collection
   * over, one thumbnail at a time.
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
   * `GET /api/health` is behind the gate, and this is the trade #521 asked to be
   * decided out loud.
   *
   * It answers the collection's counts, the database host, port and name, and
   * the lookup tallies. The counts are the collection and the rest is where the
   * collection lives, so a stranger is owed none of it. AGENTS.md calls it "the
   * one command for a running server" and it still is: `curl -i` against it
   * still answers, and a `401` is a running server saying so as plainly as a
   * body did. What it stops doing is telling anybody who asks how many books
   * somebody owns.
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
   * The catch-all 404 is behind the gate as well, which is a small improvement
   * on top of the point: a stranger cannot learn which paths this app answers by
   * asking, because every one of them says the same thing.
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
