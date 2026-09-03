/**
 * The API serving the built client, on one origin, in one process (#512).
 *
 * Until this existed nothing served the client at all. In development Vite
 * serves it and proxies `/api` here; in a deployment there is no Vite, and
 * `docs/deployment-survey.md` section 3 is where that gap was written down.
 *
 * These cases are here rather than in a browser suite because what they are
 * about is the *order* of four mounts in one file, which is invisible from a
 * screenshot and is the thing most likely to be got wrong by whoever adds the
 * fifth. In particular: a single-page fallback answers every path it is asked
 * for, so it must never be reachable from `/api`. If it is, a mistyped API path
 * comes back as `<!doctype html>` and `src/lib/api.ts`, which parses every body
 * as JSON to find the `error` field, reports a parse failure. That is #332
 * happening again through a different door.
 *
 * Driven over real HTTP against a real Postgres, on the harness the other
 * `*.routes.test.ts` files use. None of these requests reaches the database;
 * the database is here because `createApp` opens one, and building the app the
 * way production builds it is the point.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from './db.pg'
import { createApp, type BookScanApp } from './index'

let pool: pg.Pool
let db: PgDb
let scratch: string
let coverDir: string
let clientDir: string
let app: BookScanApp
let server: Server
let baseUrl: string

const SHELL = '<!doctype html><html><head><title>book-scan</title></head><body></body></html>'
const BUNDLE = 'console.log("the client")'

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('client-serving')
})

beforeEach(async () => {
  coverDir = mkdtempSync(join(scratch, 'covers-'))

  // A Vite build in miniature: a shell, a hashed asset beside it, and nothing
  // else. The hash in the filename is what earns the immutable cache header,
  // so the fixture carries one rather than a plain name.
  clientDir = mkdtempSync(join(scratch, 'client-'))
  writeFileSync(join(clientDir, 'index.html'), SHELL)
  mkdirSync(join(clientDir, 'assets'))
  writeFileSync(join(clientDir, 'assets', 'index-A1b2C3d4.js'), BUNDLE)

  app = createApp({ db, coverDir, clientDir, startBackgroundWork: false })
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
  rmSync(clientDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeScratchDatabases()
  removeScratchRoot(scratch)
})

async function get(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, init)
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    cache: response.headers.get('cache-control') ?? '',
    text: await response.text(),
  }
}

describe('the built client, served by the API', () => {
  it('answers the root with the app shell', async () => {
    const response = await get('/')
    expect(response.status).toBe(200)
    expect(response.type).toContain('text/html')
    expect(response.text).toBe(SHELL)
  })

  /*
   * The reason a single-page fallback exists at all. Every screen in this app
   * is a path the browser will ask this server for on a reload or a shared
   * link, and none of them is a file.
   */
  it('answers a screen the client routes to, not a 404', async () => {
    const response = await get('/library/9780441013593')
    expect(response.status).toBe(200)
    expect(response.text).toBe(SHELL)
  })

  it('serves the hashed bundle itself rather than the shell', async () => {
    const response = await get('/assets/index-A1b2C3d4.js')
    expect(response.status).toBe(200)
    expect(response.text).toBe(BUNDLE)
  })

  /*
   * The two halves of a build want opposite policies, and getting this backwards
   * is how a phone keeps asking for a bundle that is no longer there: the shell
   * names the hashes, so a cached shell pins a deployment that has been
   * replaced.
   */
  it('caches the hashed asset forever and the shell not at all', async () => {
    expect((await get('/assets/index-A1b2C3d4.js')).cache).toBe('public, max-age=31536000, immutable')
    expect((await get('/')).cache).toBe('no-cache')
    expect((await get('/library/anything')).cache).toBe('no-cache')
  })
})

describe('what the fallback must never swallow', () => {
  /*
   * The ordering case. `/api` is answered by the catch-all registered before
   * the client mount, so a mistyped API path is still the JSON 404 that
   * `src/lib/api.ts` can read, and never the app shell.
   */
  it('still answers an unknown /api path with JSON', async () => {
    const response = await get('/api/does-not-exist')
    expect(response.status).toBe(404)
    expect(response.type).toContain('application/json')
    expect(JSON.parse(response.text)).toEqual({ error: 'Not found.' })
  })

  it('still answers a cover nothing has with JSON', async () => {
    const response = await get('/api/covers/nothing-here.jpg')
    expect(response.status).toBe(404)
    expect(response.type).toContain('application/json')
  })

  it('still answers a real API route', async () => {
    const response = await get('/api/health')
    expect(response.status).toBe(200)
    expect(response.type).toContain('application/json')
  })

  /*
   * A POST to a path nothing answers is a mistake. Handing it the app shell at
   * 200 hides it, and the client would then try to parse HTML as a book.
   */
  it('does not answer a POST to an unknown path with the shell', async () => {
    const response = await get('/some/screen', { method: 'POST' })
    expect(response.status).toBe(404)
    expect(response.text).not.toBe(SHELL)
  })
})

describe('a client directory that is not there', () => {
  /*
   * At construction, while somebody is still watching the process start, rather
   * than as a 500 to the first person who opens the app. This is the same shape
   * as the refusal to start with no connection string: a process that exits
   * saying what is missing is recoverable in one command.
   */
  it('refuses to build the app rather than 404ing every page', () => {
    const empty = mkdtempSync(join(scratch, 'no-client-'))
    expect(() => createApp({ db, coverDir, clientDir: empty, startBackgroundWork: false }))
      .toThrow(/No built client/)
    rmSync(empty, { recursive: true, force: true })
  })

  /*
   * And absent means absent. Every test and every development run builds the
   * app without a client, and that must stay an API-only process rather than
   * one that guesses at a directory.
   */
  it('serves no client at all when none was named', async () => {
    const apiOnly = createApp({ db, coverDir, startBackgroundWork: false })
    const listener = apiOnly.listen(0)
    await new Promise<void>((resolve) => listener.once('listening', resolve))
    const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
    try {
      const response = await fetch(`${url}/`)
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('book-scan')
    } finally {
      await apiOnly.settled()
      await new Promise<void>((resolve) => { listener.close(() => resolve()) })
    }
  })
})
