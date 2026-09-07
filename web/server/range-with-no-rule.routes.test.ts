/**
 * The two screens of #479, driven over the routes they call.
 *
 * `range-with-no-rule.test.ts` beside this asks `Store` and `Shelves` directly.
 * This asks the app, because the fourth site of the issue is a route rather than
 * either of those: `POST /api/placement/preview` restates a placement in the
 * derived scheme, and it used to hand the plank the book lands on in as where
 * the range begins. Those are two questions with two answers, which is the
 * family this issue belongs to, and on a range with no run the second is `''`
 * rather than null, so the branch that says "nowhere" could not fire and the
 * screen was told "First book in non-fiction. Start at ." instead.
 *
 * `GET /api/shelves` is the other half. It read the whole run and dropped the
 * one field that says whether the run exists, so the screen had one empty
 * answer and two states behind it.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { createApp, type BookScanApp } from './index'
import { signedIn } from './testauth'
import { Shelves } from './shelves'
import { Store } from './store'
import { runRuleOf } from '../infrastructure/shelving/areas'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves
let app: BookScanApp
let server: Server
let baseUrl: string
let cookie: string
let scratch: string
let coverDir: string

interface Answer {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  })
  return { status: response.status, body: await response.json() }
}

const get = (path: string) => call('GET', path)
const post = (path: string, body: unknown) => call('POST', path, body)

/** One press of "have no rule here", over the route the rule editor posts to. */
async function takeTheRuleOff(range: 'fiction' | 'nonfiction'): Promise<void> {
  const rule = (await runRuleOf(db, range))!
  const { status, body } = await post('/api/placement/rule', {
    about: rule.areaId === null ? 'fixture' : 'area',
    placeId: rule.areaId ?? rule.fixtureId,
    rules: [],
  })
  if (status !== 200) throw new Error(`The rule editor refused: ${JSON.stringify(body)}`)
}

const draft = (title: string) =>
  ({ title, authors: [`${title} author`], genre: NON_FICTION_SLUG })

beforeAll(() => {
  scratch = scratchRoot('norule')
})

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)

  coverDir = mkdtempSync(join(scratch, 'norule-test-'))
  cookie = (await signedIn(db)).cookie
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
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

describe('the placing screen, for a range no rule serves', () => {
  it('names a plank while a rule says where the range begins', async () => {
    const { status, body } = await post('/api/placement/preview', draft('Ways of Seeing'))
    expect(status).toBe(200)
    expect(body.kind).toBe('first-in-range')
    expect(body.derivedLocation).toBe('4A')
    expect(body.instruction).toBe('First book in non-fiction. Start at 4A.')
  })

  it('says there is nowhere, rather than naming an empty plank', async () => {
    await takeTheRuleOff('nonfiction')

    const { status, body } = await post('/api/placement/preview', draft('Ways of Seeing'))
    expect(status).toBe(200)
    expect(body.kind).toBe('range-has-no-start')
    expect(body.instruction).toBe(
      'Nothing says where non-fiction begins, so there is nowhere to put this book. '
      + 'Say what belongs on a bookcase or a shelf first.',
    )
    // The two the screen answers "it fits" with, and neither of them names a
    // place. `derivedAreaId` was already null here; `derivedLocation` was ''
    // and the sentence around it read "Start at ." (#479).
    expect(body.derivedAreaId).toBeNull()
    expect(body.derivedLocation).toBe('')
    expect(body.suggestedLocation).toBe('')
  })

  it('is a saved book with nowhere to put it, not a save that failed', async () => {
    await takeTheRuleOff('nonfiction')

    const { status, body } = await post('/api/books', draft('Ways of Seeing'))
    expect(status).toBe(201)
    expect(body.id).toBeGreaterThan(0)
    expect(body.placement.kind).toBe('range-has-no-start')
    expect(body.counts.nonfiction).toBe(1)
    expect((await store.getBook(body.id))?.title).toBe('Ways of Seeing')
  })
})

describe('the shelves screen, for a range no rule serves', () => {
  it('says where the run opens while there is one', async () => {
    await post('/api/books', draft('Ways of Seeing'))

    const { body } = await get('/api/shelves?range=nonfiction')
    expect(body.begins).toBe('4A')
    expect(body.groups.map((group: { label: string }) => group.label)).toEqual(['4A'])
  })

  it('says nothing places the range, which is not the same as nothing being in it', async () => {
    await post('/api/books', draft('Ways of Seeing'))
    await takeTheRuleOff('nonfiction')

    const { body } = await get('/api/shelves?range=nonfiction')
    expect(body.begins).toBeNull()
    expect(body.groups).toEqual([])

    // The distinction the field exists for: a range nobody has catalogued into
    // draws the same empty list and has a start.
    const emptyRange = await get('/api/shelves?range=fiction')
    expect(emptyRange.body.groups.every((group: { books: unknown[] }) => !group.books.length))
      .toBe(true)
    expect(emptyRange.body.begins).toBe('1A')

    // And the book is still on the shelves the catalogue knows about.
    expect(await shelves.beginsAt('nonfiction')).toBeNull()
    expect((await store.counts()).nonfiction).toBe(1)
  })
})
