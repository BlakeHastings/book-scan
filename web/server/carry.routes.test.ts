/**
 * The two routes that take work off the carry list, over real HTTP (#402).
 *
 * What the module test beside this proves is that no book moves. What is only
 * visible from the wire is the shape of the request, and one part of that is
 * load-bearing: **a body that names half a trip is refused rather than widened
 * into all of them.** `{ from: 4 }` with the `to` lost on the way is a request
 * to withdraw one trip; treating it as "no trip named, so the whole list" would
 * answer the rules about every outstanding book in the collection on the
 * strength of a typo, which is the one way these routes could do harm.
 *
 * The harness is `refusal.routes.test.ts`'s: `createApp()` on an ephemeral port
 * with the catalogues stubbed, so nothing here reaches the network.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from './db.pg'
import { createApp, type BookScanApp } from './index'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

const empty = {
  found: false, title: '', subtitle: '', authors: [] as string[], publisher: '',
  published: '', pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
  coverUrl: '', source: '',
  classification: { genre: FICTION_SLUG, confidence: 'unknown' as const, reason: 'stub' },
  notes: [] as string[], subjects: [] as string[], categories: [] as string[],
}

vi.mock('./lookup', () => ({
  lookupIsbn: vi.fn(async () => ({ ...empty })),
  searchTitle: vi.fn(async () => ({ ...empty })),
}))

vi.mock('./covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  upgradeGoogleCover: (url: string) => url,
}))

let pool: pg.Pool
let db: PgDb
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let baseUrl: string

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('carry-routes')
})

beforeEach(async () => {
  await pool.query(
    'TRUNCATE books, book_authors, captures, book_tag, tag, author, author_alias, '
    + 'book_placement RESTART IDENTITY CASCADE',
  )
  coverDir = mkdtempSync(join(scratch, 'carry-routes-test-'))
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

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe('leaving books where they are, and asking for them back', () => {
  for (const route of ['/api/carry/leave', '/api/carry/restore']) {
    it(`${route} answers the list back, so no screen guesses at it`, async () => {
      const { status, body } = await post(route, {})

      expect(status).toBe(200)
      expect(body.books).toBe(0)
      expect(body.work).toMatchObject({ moving: 0, trips: [], setAside: [] })
    })

    it(`${route} refuses a body naming half a trip rather than widening it`, async () => {
      // Both halves, because the missing one can be either, and either way the
      // request means one trip and cannot be read as all of them.
      expect((await post(route, { from: 4 })).status).toBe(404)
      expect((await post(route, { to: 3 })).status).toBe(404)
      expect((await post(route, { from: 4, to: 'nonsense' })).status).toBe(404)
    })

    it(`${route} says what it could not find, in the shape every refusal has`,
      async () => {
        const { body } = await post(route, { from: 'nonsense' })
        expect(body.error).toBe('That trip names an area this collection does not have.')
      })
  }
})
