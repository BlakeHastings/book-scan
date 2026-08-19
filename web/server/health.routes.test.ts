/**
 * Where somebody finds out that a catalogue has been quiet (#348).
 *
 * `/api/health` is already the one command AGENTS.md tells anybody to run
 * against a running server, and it already settles which database was opened.
 * It now settles the other question about this process whose wrong answer is
 * invisible from outside: whether the second catalogue has ever answered.
 *
 * `source-watch.test.ts` is where the record itself is put through its cases and
 * `lookup-sources.test.ts` is where a real catalogue is made to fail. What is
 * here is the wiring, and it is worth a real request for the reason
 * `backup.routes.test.ts` gives about `/api/backup`: the route is the wiring, so
 * calling `sourceStandings()` directly would prove nothing about whether it is
 * reached.
 *
 * The harness is `backup.routes.test.ts`'s, unchanged.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from './db.pg'
import { createApp, type BookScanApp } from './index'
import {
  CATALOGUES, forgetSourceStandings, noteSourceAnswer, noteSourceSkipped,
} from './source-watch'

/** A key nothing may echo. Chosen to be findable in a raw response body. */
const API_KEY = 'not-a-real-key-4b7e2a'

let pool: pg.Pool
let db: PgDb
let scratch: string
const running: Array<{ app: BookScanApp; server: Server }> = []

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('health-routes')
})

afterAll(async () => {
  for (const one of running) {
    await one.app.settled()
    await new Promise<void>((resolve, reject) => {
      one.server.close((error) => (error ? reject(error) : resolve()))
    })
  }
  await closeScratchDatabases()
  removeScratchRoot(scratch)
  running.length = 0
})

beforeEach(() => {
  forgetSourceStandings()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

/** An app with or without a Google Books key, listening, and its base URL. */
async function serving(googleApiKey?: string): Promise<string> {
  const coverDir = mkdtempSync(join(scratch, 'covers-'))
  const app = createApp({ db, coverDir, startBackgroundWork: false, googleApiKey })
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  running.push({ app, server })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('GET /api/health', () => {
  it('still answers everything it answered before', async () => {
    const answer = await (await fetch(`${await serving()}/api/health`)).json()

    expect(answer.ok).toBe(true)
    expect(answer.counts).toBeTruthy()
    expect(typeof answer.db).toBe('string')
  })

  it('names every catalogue, so one that has never been asked is visible as that', async () => {
    /*
     * Four of them since #305, and the last two are the ones this matters most
     * for: they are a top-up asked only about a book the first two left without
     * a page count or a genre, so `asked: 0` after a long session is a real and
     * good state rather than a source that has been left out of the report.
     */
    const answer = await (await fetch(`${await serving()}/api/health`)).json()

    expect(answer.lookups.sources.map((one: { source: string }) => one.source))
      .toEqual([...CATALOGUES])
    expect(answer.lookups.sources).toHaveLength(4)
    for (const one of answer.lookups.sources) {
      expect(one).toMatchObject({ asked: 0, answered: 0, silent: 0, skipped: 0 })
    }
  })

  it('reports a catalogue that consulted and heard nothing', async () => {
    const base = await serving()
    noteSourceAnswer('Open Library', true)
    noteSourceAnswer('Google Books', false, 'HTTP 429')
    noteSourceAnswer('Google Books', false, 'HTTP 429')

    const answer = await (await fetch(`${base}/api/health`)).json()
    const google = answer.lookups.sources.find((one: { source: string }) => one.source === 'Google Books')

    expect(google).toMatchObject({ asked: 2, answered: 0, silent: 2, lastSilence: 'HTTP 429' })

    // Still healthy. A source being down is not this server being unwell:
    // somebody can still catalogue a book, which is why a failed source does
    // not fail a lookup in the first place.
    expect(answer.ok).toBe(true)
  })

  it('reports a catalogue that was wanted and not asked, as neither of the other two', async () => {
    /*
     * #305 put two free national catalogues behind a rate limiter, and the
     * failure mode a rate limiter has is costing answers quietly. Nothing was
     * sent, so the catalogue neither answered nor stayed silent and owes no
     * explanation; the decision was this application's, and it is counted as
     * this application's.
     */
    const base = await serving()
    noteSourceSkipped('Library of Congress')

    const answer = await (await fetch(`${base}/api/health`)).json()
    const loc = answer.lookups.sources
      .find((one: { source: string }) => one.source === 'Library of Congress')

    expect(loc).toMatchObject({ asked: 0, answered: 0, silent: 0, skipped: 1, lastSilence: '' })
    expect(answer.ok).toBe(true)
  })

  it('says whether a key is configured, and never what it is', async () => {
    const without = await (await fetch(`${await serving()}/api/health`)).json()
    expect(without.lookups.googleBooksKeyConfigured).toBe(false)

    const response = await fetch(`${await serving(API_KEY)}/api/health`)
    const body = await response.text()

    expect(JSON.parse(body).lookups.googleBooksKeyConfigured).toBe(true)
    // The raw body, not the parsed object, so a key smuggled into any field at
    // any depth would fail this.
    expect(body).not.toContain(API_KEY)
  })
})
