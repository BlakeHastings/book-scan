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
import { signedIn } from './testauth'
import {
  CATALOGUES, forgetSourceStandings, noteSourceAnswer, noteSourceSkipped,
} from './source-watch'
import { REBUILD_COMMAND } from '../infrastructure/placement/projection'

/** A key nothing may echo. Chosen to be findable in a raw response body. */
const API_KEY = 'not-a-real-key-4b7e2a'

let pool: pg.Pool
let db: PgDb
let scratch: string
const running: Array<{ app: BookScanApp; server: Server }> = []

/**
 * The session every request in this file carries.
 *
 * `/api/health` is behind the gate since #521 and answers `401` without one.
 * That is the trade AGENTS.md's "one command for a running server" now makes,
 * and `gate.routes.test.ts` is where the refusal itself is asserted; this file
 * is about what the answer says once somebody is allowed to see it.
 *
 * Made once rather than per test, because nothing here empties the catalogue.
 */
let cookie = ''

/** A request holding the session, which is what a phone's request is. */
const ask = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, headers: { cookie, ...init.headers } })

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  cookie = (await signedIn(db)).cookie
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
    const answer = await (await ask(`${await serving()}/api/health`)).json()

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
    const answer = await (await ask(`${await serving()}/api/health`)).json()

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

    const answer = await (await ask(`${base}/api/health`)).json()
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

    const answer = await (await ask(`${base}/api/health`)).json()
    const loc = answer.lookups.sources
      .find((one: { source: string }) => one.source === 'Library of Congress')

    expect(loc).toMatchObject({ asked: 0, answered: 0, silent: 0, skipped: 1, lastSilence: '' })
    expect(answer.ok).toBe(true)
  })

  it('says whether a key is configured, and never what it is', async () => {
    const without = await (await ask(`${await serving()}/api/health`)).json()
    expect(without.lookups.googleBooksKeyConfigured).toBe(false)

    const response = await ask(`${await serving(API_KEY)}/api/health`)
    const body = await response.text()

    expect(JSON.parse(body).lookups.googleBooksKeyConfigured).toBe(true)
    // The raw body, not the parsed object, so a key smuggled into any field at
    // any depth would fail this.
    expect(body).not.toContain(API_KEY)
  })
})

/**
 * The other question about this process whose wrong answer is invisible (#505).
 *
 * `applySchema` has counted these on every start since the projection landed and
 * **nothing has ever read the line**. It is also printed once, so a writer that
 * stops recording itself an hour after boot is not reported until the next
 * restart. Asked here it is answered about now.
 *
 * These tests build the disagreement out of the rows rather than by stubbing the
 * check, because the wiring is the thing in question: calling
 * `countProjectionDisagreements` directly would prove nothing about whether the
 * route reaches it. That is `backup.routes.test.ts`'s argument, and
 * `placement-ledger.test.ts` is where the check itself is put through its cases.
 */
describe('GET /api/health and the placement projection', () => {
  /**
   * A book whose column says a plank and whose ledger says nothing at all.
   *
   * Which is the shape of the defect exactly: something wrote a placement and
   * recorded nothing. Returns what to run to put the catalogue back.
   */
  async function aBookPlacedWithoutARecord(title: string): Promise<() => Promise<void>> {
    // An area hangs on a fixture and a fixture hangs on a collection, and the
    // migrations leave exactly one collection behind for a bookcase to hang off.
    const fixture = await db.get<{ id: number }>(
      `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
       SELECT id, 'bookshelf', '', 9505, 'inherit', '' FROM collection ORDER BY id LIMIT 1
       RETURNING id`,
    )
    expect(fixture, 'no collection to hang a bookcase off').toBeDefined()

    const area = await db.get<{ id: number }>(
      `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
       VALUES (?, 0, '', '', 'inherit', '') RETURNING id`,
      [fixture!.id],
    )
    const book = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state, current_area_id)
       VALUES (?, 'fiction', ?, '2026-09-03T00:00:00.000Z', 'shelved', ?) RETURNING id`,
      [title, title.toUpperCase(), area!.id],
    )

    return async () => {
      await db.run('DELETE FROM books WHERE id = ?', [book!.id])
      await db.run('DELETE FROM fixture WHERE id = ?', [fixture!.id])
    }
  }

  it('says the projection agrees, and stays ok, on an ordinary catalogue', async () => {
    const answer = await (await ask(`${await serving()}/api/health`)).json()

    expect(answer.ok).toBe(true)
    expect(answer.placement.projection).toEqual({ disagreeing: 0, books: [], repair: '' })
  })

  it('names the books, and answers not ok, when a placement was not recorded', async () => {
    const base = await serving()
    const undo = await aBookPlacedWithoutARecord('A Book Nobody Wrote Down')

    try {
      const answer = await (await ask(`${base}/api/health`)).json()

      // `ok` is the field a machine reads without knowing the shape of the rest,
      // and this is the one condition on this endpoint that moves it: a quiet
      // catalogue leaves it true because somebody can still catalogue a book,
      // and so would a drifted shelf, because a person resolves that by carrying
      // books. This one says the server wrote something it cannot account for.
      expect(answer.ok).toBe(false)
      expect(answer.placement.projection.disagreeing).toBe(1)
      expect(answer.placement.projection.books).toEqual([{
        bookId: expect.any(Number),
        title: 'A Book Nobody Wrote Down',
        projected: expect.any(Number),
        fromLedger: null,
      }])
    } finally {
      await undo()
    }
  })

  it('names a command to run and never a way to write from here', async () => {
    const base = await serving()
    const undo = await aBookPlacedWithoutARecord('Another Book Nobody Wrote Down')

    try {
      const answer = await (await ask(`${base}/api/health`)).json()

      // The repair is a command somebody runs having read the names, not a
      // button and not a POST. #485's diagnosis depended on the broken state
      // surviving restarts, so a repair reachable from a request is the one
      // thing this must not grow. Asserted rather than described, because an
      // endpoint that looks unfinished without a write is how one gets added.
      expect(answer.placement.projection.repair).toBe(REBUILD_COMMAND)
      expect(answer.placement.projection.repair).not.toMatch(/https?:|\/api\//)

      expect((await ask(`${base}/api/health`, { method: 'POST' })).status).toBe(404)
      expect((await ask(`${base}/api/placement/projection`)).status).toBe(404)
    } finally {
      await undo()
    }
  })

  it('goes back to ok once the ledger and the column agree again', async () => {
    // The failure path that matters most: an ordinary day says nothing. Without
    // this, an endpoint stuck at `ok: false` would pass every test above.
    const base = await serving()
    const undo = await aBookPlacedWithoutARecord('A Third Book Nobody Wrote Down')
    expect((await (await ask(`${base}/api/health`)).json()).ok).toBe(false)

    await undo()

    const after = await (await ask(`${base}/api/health`)).json()
    expect(after.ok).toBe(true)
    expect(after.placement.projection).toEqual({ disagreeing: 0, books: [], repair: '' })
  })
})
