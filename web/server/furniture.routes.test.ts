/**
 * The furniture routes, driven over real HTTP against a catalogue with books in
 * it.
 *
 * **Books in it is the point.** Every route here has an easy answer on an empty
 * database and a real one on the owner's, so every test builds a room with books
 * on the shelves and then rearranges it. A suite that only proved a fixture
 * could be created and deleted would prove nothing about the day somebody
 * actually uses this.
 *
 * Two of them build his own room, fifty non-fiction books cut 8, 20 and 22 across
 * bookcase 4, and the rest build the same shape three planks smaller. See
 * `buildWorld`: what is being proved is the arithmetic, and fifty saves seventeen
 * times over is a minute of every CI run spent proving it again.
 *
 * The app is built with `createApp()` and started on an ephemeral port, the same
 * way `index.test.ts` and `tags.routes.test.ts` do it, because there is no
 * supertest in this project and this suite must not add one. Nothing here
 * touches the network: the world is built through `Store` and the handlers, the
 * way `relocate-run.test.ts` builds it, so no lookup is ever made.
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
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves
let app: BookScanApp
let server: Server
let baseUrl: string
/** This file's own scratch root, which no other test file can name. */
let scratch: string
let coverDir: string

/** A save, all four steps of it, exactly as `POST /api/books` performs them. */
async function shelve(draft: DraftBook): Promise<number> {
  const authors = new DrizzleAuthorRepository(db)
  const tags = new DrizzleTagRepository(db)
  const { id, placement } = await store.addBook(draft)
  await settleGenre(new RestateTagsHandler(tags, new DbBookTransactions(db)), tags, id, draft)
  await recordCredits(
    new CreditBookHandler(authors), authors, new FileAliasHandler(authors), id, draft,
  )
  const landed = placement && await shelves.labelFor(placement.range, id)
  if (landed) await store.setLocation(id, landed)
  return id
}

const draft = (at: number, genre = NON_FICTION_SLUG): DraftBook => ({
  title: `Title ${String(at).padStart(3, '0')}`,
  authors: [`Author ${String(at).padStart(3, '0')}`],
  genre,
})

/**
 * A room with books in it: non-fiction on bookcase 4, cut into three planks, and
 * fiction elsewhere.
 *
 * The same world `relocate-run.test.ts` builds and the same order the room
 * happened in: the dividers go in around books that were already there.
 *
 * **The size is a parameter and the default is small on purpose.** What every
 * test here needs is a catalogue that is not empty, because every one of these
 * routes has an easy answer on an empty database and a real one on the owner's.
 * What only one of them needs is his actual fifty, and building fifty books
 * seventeen times over costs most of a minute of every CI run to re-prove the
 * same arithmetic.
 */
async function buildWorld(books = 6, cuts = [2, 4]): Promise<number[]> {
  const ids: number[] = []
  for (let at = 0; at < books; at += 1) ids.push(await shelve(draft(at)))
  ids.push(await shelve(draft(100, FICTION_SLUG)))

  const run = await shelves.layout('nonfiction')
  const separators = new DrizzleSeparatorRepository(db)
  for (const [position, first] of cuts.entries()) {
    await separators.add({
      range: 'nonfiction',
      kind: 'area',
      startsAt: run[first]!.book.sortKey,
      position,
      note: '',
      createdAt: new Date().toISOString(),
    })
  }

  for (const placed of await shelves.layout('nonfiction')) {
    await store.setLocation(placed.book.id, placed.label)
  }

  return ids
}

/** The owner's own room: fifty non-fiction books cut 8, 20 and 22. */
const buildTheWorld = () => buildWorld(50, [8, 28])

interface Answer {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}

const get = (path: string) => call('GET', path)
const post = (path: string, body?: unknown) => call('POST', path, body ?? {})
const patch = (path: string, body: unknown) => call('PATCH', path, body)
const remove = (path: string) => call('DELETE', path)

/** The bookcase the non-fiction run stands on, which is number 4. */
async function nonFiction() {
  const { body } = await get('/api/fixtures')
  return body.fixtures.find((one: { position: number }) => one.position === 4)
}

/** Every placement row in the catalogue, so a test can prove none was deleted. */
async function everyPlacement(): Promise<{ id: number; area_id: number | null }[]> {
  return db.all('SELECT id, area_id FROM book_placement ORDER BY id')
}

interface SeededFurniture {
  fixtures: {
    id: number; position: number; kind: string; name: string;
    sort_strategy: string; note: string;
  }[]
  areas: {
    id: number; position: number; name: string; starts_at: string;
    sort_strategy: string; note: string;
  }[]
  /**
   * The rules, for the switch on them.
   *
   * Added by #341 for the same reason the two above were: a test in this file
   * now turns a rule off, and `RESTORE_FURNITURE` in `testdb.ts` does not put a
   * switch back. Left uncaptured, one test switching Non-fiction off would hand
   * every test after it a room where nothing files anything, and the failure
   * would land in whichever one built its world next.
   */
  rules: { id: number; enabled: boolean; priority: number; name: string }[]
}

/**
 * The furniture as the migration leaves it, put back between tests.
 *
 * `openTestDatabase` restores the *shape* of the seeded furniture, deleting the
 * areas and fixtures a test added, and it has never had to restore anything
 * else: nothing in this repository could rename a bookcase or renumber one until
 * now. This file does exactly that, so a test that calls bookcase 4 "Hall shelf"
 * would hand the next one a room with no plank called `4A` in it, and the
 * failure lands in whichever test built its world next.
 */
let seeded: SeededFurniture | undefined

async function captureFurniture(): Promise<SeededFurniture> {
  return {
    fixtures: await db.all(
      'SELECT id, position, kind, name, sort_strategy, note FROM fixture ORDER BY id',
    ),
    areas: await db.all(
      'SELECT id, position, name, starts_at, sort_strategy, note FROM area ORDER BY id',
    ),
    rules: await db.all('SELECT id, enabled, priority, name FROM placement_rule ORDER BY id'),
  }
}

async function restoreFurniture(from: SeededFurniture): Promise<void> {
  for (const one of from.fixtures) {
    await db.run(
      'UPDATE fixture SET position = ?, kind = ?, name = ?, sort_strategy = ?, note = ? WHERE id = ?',
      [one.position, one.kind, one.name, one.sort_strategy, one.note, one.id],
    )
  }
  for (const one of from.areas) {
    await db.run(
      `UPDATE area SET position = ?, name = ?, starts_at = ?, sort_strategy = ?, note = ?
        WHERE id = ?`,
      [one.position, one.name, one.starts_at, one.sort_strategy, one.note, one.id],
    )
  }
  for (const one of from.rules) {
    await db.run(
      'UPDATE placement_rule SET enabled = ?, priority = ?, name = ? WHERE id = ?',
      [one.enabled, one.priority, one.name, one.id],
    )
  }
}

beforeAll(() => {
  scratch = scratchRoot('furniture')
})

beforeEach(async () => {
  db = await openTestDatabase()
  if (seeded) await restoreFurniture(seeded)
  else seeded = await captureFurniture()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)

  coverDir = mkdtempSync(join(scratch, 'furniture-test-'))
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
  // The per-test cover directories go in `afterEach`; this is the root they were
  // made in, and it belongs to this file alone (#297).
  removeScratchRoot(scratch)
})

describe('reading the room', () => {
  it('answers the furniture the catalogue already has, with labels worked out', async () => {
    await buildTheWorld()

    const answer = await get('/api/fixtures')
    expect(answer.status).toBe(200)

    const bookcase = await nonFiction()
    expect(bookcase.label).toBe('4')
    expect(bookcase.books).toBe(50)
    expect(bookcase.areas.map((one: { label: string; books: number }) =>
      [one.label, one.books])).toEqual([['4A', 8], ['4B', 20], ['4C', 22]])

    // No label is stored anywhere, so none comes back off a column.
    const stored = await db.all<{ count: number }>(
      `SELECT count(*) AS count FROM information_schema.columns
        WHERE table_name IN ('fixture', 'area') AND column_name = 'label'`,
    )
    expect(Number(stored[0]!.count)).toBe(0)
  })

  /**
   * The screens draw "what belongs here" on every piece and every area, and a
   * furniture screen that could say how many books stand somewhere and nothing
   * about why they are there would be missing the question it exists to answer.
   *
   * Two things are checked and the second is the one that will break first. A
   * rule points at a *piece*, so only the first area on it is where the run
   * begins and the rest are that run carrying on; a change that answered "Non-
   * fiction starts here" on all three would read plausibly and be wrong about
   * where a book lands. And **a tag is named by its label**: `genre/non-fiction`
   * is an identity, and it is the shape of thing that reaches a screen by
   * accident.
   */
  it('says what files onto each piece and each area, in words and never in slugs',
    async () => {
      await buildWorld()

      const bookcase = await nonFiction()
      expect(bookcase.holds).toBe('Anything tagged Non-fiction')
      expect(bookcase.rule.about).toBe('fixture')
      expect(bookcase.rule.conditions).toEqual([{ operator: 'is', tag: 'Non-fiction' }])

      expect(bookcase.areas.map((one: { holds: string; entry: boolean }) =>
        [one.holds, one.entry])).toEqual([
        ['Non-fiction starts here', true],
        ['Non-fiction, carrying on', false],
        ['Non-fiction, carrying on', false],
      ])

      const { body } = await get('/api/fixtures')
      expect(JSON.stringify(body)).not.toMatch(/genre\//)
    })

  /**
   * An area with an order of its own takes no overflow, so it opens a run, and
   * nothing points at that run. Saying "Non-fiction, carrying on" there would be
   * claiming books arrive somewhere they cannot reach.
   */
  it('says an area nothing can reach is filled by hand', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const middle = bookcase.areas[1]

    const set = await patch(`/api/areas/${middle.id}`, {
      sortStrategy: 'title', acknowledge: true,
    })
    expect(set.status).toBe(200)

    expect((await nonFiction()).areas.map((one: { holds: string }) => one.holds)).toEqual([
      'Non-fiction starts here', 'Put here by hand', 'Put here by hand',
    ])
  })
})

describe('describing a piece of furniture that has never existed', () => {
  it('takes a name, a kind, areas in an order, and reads them back', async () => {
    await buildWorld()

    const made = await post('/api/fixtures', { kind: 'windowsill', name: 'By the window' })
    expect(made.status).toBe(201)
    const id = made.body.fixture.id
    expect(made.body.fixture.label).toBe('By the window')
    expect(made.body.fixture.areas).toEqual([])

    for (const name of ['', 'Cookery', '']) {
      const area = await post(`/api/fixtures/${id}/areas`, { name })
      expect(area.status).toBe(201)
    }

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { label: string }) => one.label)).toEqual([
      'By the window · A', 'By the window · Cookery', 'By the window · C',
    ])
    // Nothing about the catalogue that already existed moved.
    expect((await nonFiction()).books).toBe(6)
  })

  it('renames a piece and says every label that reads differently', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const before = await everyPlacement()

    const renamed = await patch(`/api/fixtures/${bookcase.id}`, { name: 'Hall shelf' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.becomes).toEqual([
      { from: '4A', to: 'Hall shelf · A' },
      { from: '4B', to: 'Hall shelf · B' },
      { from: '4C', to: 'Hall shelf · C' },
    ])

    // A rename strands nothing: a book's recorded location is an area row, so
    // the ledger is untouched and every book reads under the new name.
    expect(await everyPlacement()).toEqual(before)
    expect((await nonFiction()).areas.map((one: { books: number }) => one.books))
      .toEqual([2, 2, 2])
  })

  it('renumbers a piece without moving a book, and says who else is on that number',
    async () => {
      await buildWorld()
      const bookcase = await nonFiction()
      const before = await everyPlacement()

      const moved = await patch(`/api/fixtures/${bookcase.id}`, { position: 1 })
      expect(moved.status).toBe(200)
      expect(moved.body.becomes).toEqual([
        { from: '4A', to: '1A' },
        { from: '4B', to: '1B' },
        { from: '4C', to: '1C' },
      ])
      expect(await everyPlacement()).toEqual(before)

      // Bookcase 1 is where fiction already stands, and two pieces on one number
      // is an arrangement this catalogue has to be able to record rather than
      // one to refuse. It is reported instead.
      expect(moved.body.fixture.sharing).toHaveLength(1)
    })
})

describe('reordering the areas on a piece', () => {
  /** A piece with five unanchored planks, which is somebody typing furniture in. */
  async function fivePlanks(): Promise<{ id: number; areas: number[] }> {
    const made = await post('/api/fixtures', { name: 'By the window' })
    const id = made.body.fixture.id
    const areas: number[] = []
    for (let at = 0; at < 5; at += 1) {
      areas.push((await post(`/api/fixtures/${id}/areas`, {})).body.area.id)
    }
    return { id, areas }
  }

  it('moves one to the front without two areas ever sharing an ordinal', async () => {
    await buildWorld()
    const { id, areas } = await fivePlanks()

    const moved = await patch(`/api/areas/${areas[4]}`, { position: 0 })
    expect(moved.status).toBe(200)

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { id: number }) => one.id))
      .toEqual([areas[4], areas[0], areas[1], areas[2], areas[3]])
    expect(body.fixture.areas.map((one: { position: number }) => one.position))
      .toEqual([0, 1, 2, 3, 4])
    expect(moved.body.becomes).toEqual([
      { from: 'By the window · E', to: 'By the window · A' },
      { from: 'By the window · A', to: 'By the window · B' },
      { from: 'By the window · B', to: 'By the window · C' },
      { from: 'By the window · C', to: 'By the window · D' },
      { from: 'By the window · D', to: 'By the window · E' },
    ])
  })

  it('swaps two neighbours, which is the move a one-pass update collides on', async () => {
    await buildWorld()
    const { id, areas } = await fivePlanks()

    expect((await patch(`/api/areas/${areas[1]}`, { position: 0 })).status).toBe(200)

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { id: number }) => one.id))
      .toEqual([areas[1], areas[0], areas[2], areas[3], areas[4]])
  })

  it('inserts an area between two that exist and shuffles the rest along', async () => {
    await buildWorld()
    const { id, areas } = await fivePlanks()

    const added = await post(`/api/fixtures/${id}/areas`, { position: 1, name: 'Cookery' })
    expect(added.status).toBe(201)
    expect(added.body.becomes).toEqual([
      { from: 'By the window · B', to: 'By the window · C' },
      { from: 'By the window · C', to: 'By the window · D' },
      { from: 'By the window · D', to: 'By the window · E' },
      { from: 'By the window · E', to: 'By the window · F' },
    ])

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { id: number }) => one.id))
      .toEqual([areas[0], added.body.area.id, areas[1], areas[2], areas[3], areas[4]])
  })

  it('refuses to put an area in front of one whose books come before it', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const refused = await patch(`/api/areas/${bookcase.areas[2].id}`, { position: 0 })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('cannot start before')

    // And nothing moved.
    expect((await nonFiction()).areas.map((one: { label: string }) => one.label))
      .toEqual(['4A', '4B', '4C'])
  })
})

describe('removing an area from a bookcase that is not empty', () => {
  it('says what becomes of its books before anything happens', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const before = await everyPlacement()

    const { status, body } = await get(`/api/areas/${bookcase.areas[1].id}/removal`)
    expect(status).toBe(200)
    expect(body.plan.area).toEqual({ id: bookcase.areas[1].id, label: '4B', books: 2 })
    expect(body.plan.into).toEqual({ id: bookcase.areas[0].id, label: '4A' })
    expect(body.plan.joins).toBe('previous')
    expect(body.plan.joining).toBe(2)
    expect(body.plan.skipped).toEqual([])
    expect(body.plan.becomes).toEqual([
      { from: '4B', to: '4A' },
      { from: '4C', to: '4B' },
    ])

    // Strictly a plan.
    expect(await everyPlacement()).toEqual(before)
  })

  it('merges it into the area before, writes assignments, and deletes no placement',
    async () => {
      await buildTheWorld()
      const bookcase = await nonFiction()
      const going = bookcase.areas[1].id
      const into = bookcase.areas[0].id
      const before = await everyPlacement()

      const removed = await remove(`/api/areas/${going}`)
      expect(removed.status).toBe(200)
      expect(removed.body.plan.joining).toBe(20)

      // Every row that existed is still there, and the twenty new ones are
      // assignments naming the area that took the books in.
      const after = await everyPlacement()
      expect(after.slice(0, before.length)).toEqual(before)
      expect(after).toHaveLength(before.length + 20)

      const written = await db.all<{ kind: string; area_id: number; actor: string }>(
        'SELECT kind, area_id, actor FROM book_placement ORDER BY id DESC LIMIT 20',
      )
      expect(written.every((row) => row.kind === 'assigned')).toBe(true)
      expect(written.every((row) => Number(row.area_id) === into)).toBe(true)
      expect(written.every((row) => row.actor === 'rules')).toBe(true)

      // The plank is retired rather than deleted, so a book recorded on it is
      // still recorded on it: the row survives at a negative ordinal.
      const retired = await db.get<{ position: number }>(
        'SELECT position FROM area WHERE id = ?', [going],
      )
      expect(Number(retired!.position)).toBeLessThan(0)

      // The face is two planks now, and the third has shuffled up into 4B.
      const face = await nonFiction()
      expect(face.areas.map((one: { id: number; label: string }) => [one.id, one.label]))
        .toEqual([[into, '4A'], [bookcase.areas[2].id, '4B']])
    })

  it('leaves a pinned book alone and says how many it left alone', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const going = bookcase.areas[1].id

    const pinned = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1', [going],
    )
    await new DrizzlePlacementLedger(db).record({
      bookId: pinned!.id,
      kind: 'pinned',
      areaId: going,
      sortKey: '',
      actor: 'person',
      reason: 'it lives here',
      createdAt: new Date().toISOString(),
    })

    const planned = await get(`/api/areas/${going}/removal`)
    expect(planned.body.plan.joining).toBe(1)
    expect(planned.body.plan.skipped).toEqual([{ reason: 'pinned', books: 1 }])

    const removed = await remove(`/api/areas/${going}`)
    expect(removed.body.plan.skipped).toEqual([{ reason: 'pinned', books: 1 }])

    // The pin still stands, and still names the plank it was made on.
    const rows = await new DrizzlePlacementLedger(db).forBooks([pinned!.id])
    expect(rows.filter((row) => row.kind === 'assigned')).toEqual([])
    expect(rows[rows.length - 1]!.kind).toBe('pinned')
  })

  it('brings the next area forward when the first one goes, anchor and all', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const going = bookcase.areas[0].id
    const into = bookcase.areas[1].id

    const planned = await get(`/api/areas/${going}/removal`)
    expect(planned.body.plan.joins).toBe('next')
    expect(planned.body.plan.into).toEqual({ id: into, label: '4B' })
    expect(planned.body.plan.joining).toBe(2)
    expect(planned.body.plan.becomes).toEqual([
      { from: '4B', to: '4A' },
      { from: '4C', to: '4B' },
    ])

    expect((await remove(`/api/areas/${going}`)).status).toBe(200)

    // The area coming forward took over the removed one's anchor, which is what
    // opens it at the beginning of the run rather than a third of the way in.
    const anchor = await db.get<{ starts_at: string }>(
      'SELECT starts_at FROM area WHERE id = ?', [into],
    )
    expect(anchor!.starts_at).toBe('')

    const face = await nonFiction()
    expect(face.areas.map((one: { id: number; label: string }) => [one.id, one.label]))
      .toEqual([[into, '4A'], [bookcase.areas[2].id, '4B']])
  })

  it('refuses the only area on a piece, and says what the way out is', async () => {
    await buildWorld()
    const made = await post('/api/fixtures', { kind: 'desk', name: 'Desk' })
    const id = made.body.fixture.id
    const only = (await post(`/api/fixtures/${id}/areas`, { name: 'Left side' })).body.area.id

    const refused = await remove(`/api/areas/${only}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('Desk · Left side')
    expect(refused.body.error).toContain('Deleting the piece')

    expect((await get(`/api/fixtures/${id}`)).body.fixture.areas).toHaveLength(1)
  })
})

describe('removing a piece of furniture', () => {
  it('refuses while books are standing on it, and says how many', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const planned = await get(`/api/fixtures/${bookcase.id}/removal`)
    expect(planned.body.removal.books).toBe(6)
    expect(planned.body.removal.areas).toBe(3)

    const refused = await remove(`/api/fixtures/${bookcase.id}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('Its 6 books move to other furniture first.')

    expect((await nonFiction()).areas).toHaveLength(3)
  })

  it('takes an empty one away entirely', async () => {
    await buildWorld()
    const made = await post('/api/fixtures', { name: 'Crate', kind: 'crate' })
    const id = made.body.fixture.id
    await post(`/api/fixtures/${id}/areas`, {})

    const removed = await remove(`/api/fixtures/${id}`)
    expect(removed.status).toBe(200)
    expect(removed.body.removed.retires).toBe(false)

    expect((await get(`/api/fixtures/${id}`)).status).toBe(404)
    expect(await db.get('SELECT id FROM fixture WHERE id = ?', [id])).toBeUndefined()
  })
})

describe('giving an area an order of its own', () => {
  it('refuses until somebody has been told it stops taking overflow', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const middle = bookcase.areas[1].id

    const refused = await patch(`/api/areas/${middle}`, { sortStrategy: 'title' })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('nothing overflows into it')
    expect(refused.body.effect.selfContained).toBe(true)
    expect(refused.body.effect.affected).toEqual(['4B', '4C'])

    // Nothing was written on the refusal.
    expect((await nonFiction()).areas[1].sortStrategy).toBe('inherit')

    const agreed = await patch(`/api/areas/${middle}`, {
      sortStrategy: 'title', acknowledge: true,
    })
    expect(agreed.status).toBe(200)
    expect(agreed.body.area.selfContained).toBe(true)
    expect(agreed.body.area.ordering).toBe('title')
  })

  it('lets a piece decide for its areas, which inherit it without cutting a run',
    async () => {
      await buildWorld()
      const bookcase = await nonFiction()

      const set = await patch(`/api/fixtures/${bookcase.id}`, { sortStrategy: 'published' })
      expect(set.status).toBe(200)
      expect(set.body.fixture.areas.every((one: { ordering: string }) =>
        one.ordering === 'published')).toBe(true)
      expect(set.body.fixture.areas.every((one: { selfContained: boolean }) =>
        !one.selfContained)).toBe(true)
    })
})

/**
 * The two routes #318 said were missing, and the workaround one of them killed.
 *
 * The first is "what is standing in this area", which cutting an area in two
 * needs and which nothing answered: #313 asked for both stretches of shelving
 * and matched an area up by its **label**. A label is worked out at read time
 * from four things, any of which a person can change, so the test that matters
 * is not that the list is right today: it is that the list is still right after
 * the rename that would have broken the match.
 */
describe('what is standing in an area', () => {
  it('lists its books in the order they stand, by identity', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const { status, body } = await get(`/api/areas/${bookcase.areas[1].id}/books`)
    expect(status).toBe(200)
    expect(body.area).toEqual({ id: bookcase.areas[1].id, label: '4B', books: 2 })
    expect(body.books.map((one: { title: string }) => one.title))
      .toEqual(['Title 002', 'Title 003'])
    // The anchor a boundary is cut at, which is the whole reason this is asked.
    expect(body.books[0].sortKey.length).toBeGreaterThan(0)
  })

  /**
   * The workaround's own failure, made to happen.
   *
   * Renaming the bookcase relabels every plank on it: `4B` becomes
   * `Hall shelf · B`. A screen matching on the label would find no group at all
   * and silently offer nothing to cut. The row is unchanged, so this still
   * answers the same two books.
   */
  it('is unmoved by a rename that would have broken a match on labels', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const middle = bookcase.areas[1].id

    const renamed = await patch(`/api/fixtures/${bookcase.id}`, { name: 'Hall shelf' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.becomes).toContainEqual({ from: '4B', to: 'Hall shelf · B' })

    const { status, body } = await get(`/api/areas/${middle}/books`)
    expect(status).toBe(200)
    expect(body.area.label).toBe('Hall shelf · B')
    expect(body.books.map((one: { title: string }) => one.title))
      .toEqual(['Title 002', 'Title 003'])
  })

  /**
   * A book nothing claims is invisible from every count on these screens, and
   * it is a real state since #304: no source states a genre, no tag is written,
   * and no rule matches it. It stands where somebody put it and no plan will
   * ever move it, so the area says so.
   */
  it('says which of its books no rule claims at all', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const area = bookcase.areas[0].id

    const orphan = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1', [area],
    )
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [orphan!.id])

    const { body } = await get(`/api/areas/${area}/books`)
    const found = body.books.find((one: { id: number }) => one.id === orphan!.id)
    expect(found.claimedBy).toBeNull()
    expect(body.books
      .filter((one: { claimedBy: string | null }) => one.claimedBy !== null)
      .every((one: { claimedBy: string }) => one.claimedBy === 'Non-fiction')).toBe(true)
  })

  it('refuses an area that is not on any face', async () => {
    await buildWorld()
    const { status, body } = await get('/api/areas/999999/books')
    expect(status).toBe(404)
    expect(body.error).toBe('No such area.')
  })
})

/**
 * Why one book is here, which is the screen that makes the rules legible to
 * somebody who did not write them.
 *
 * **The losers are the point.** A book that lands somewhere surprising is the
 * moment the whole idea either explains itself or turns into magic, and the
 * explanation is which rules asked for it and why one beat the other.
 */
describe('why a book is here', () => {
  /** The book at the top of the non-fiction, which every test here is about. */
  async function first(): Promise<number> {
    const bookcase = await nonFiction()
    const row = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1',
      [bookcase.areas[0].id],
    )
    return Number(row!.id)
  }

  it('names the rule that claimed it, where it stands and where the rules want it',
    async () => {
      await buildWorld()
      const id = await first()

      const { status, body } = await get(`/api/books/${id}/claim`)
      expect(status).toBe(200)
      expect(body.claim.claims).toHaveLength(1)
      expect(body.claim.claims[0].won).toBe(true)
      expect(body.claim.claims[0].rule.name).toBe('Non-fiction')
      expect(body.claim.claims[0].rule.range).toBe('nonfiction')
      expect(body.claim.standing.label).toBe('4A')
      expect(body.claim.wanted.label).toBe('4A')
      expect(body.claim.pinned).toBe(false)
      expect(body.claim.tags).toEqual(['Non-fiction'])
    })

  it('draws a tag by its label and never by its slug', async () => {
    await buildWorld()
    const { body } = await get(`/api/books/${await first()}/claim`)
    expect(JSON.stringify(body)).not.toMatch(/genre\//)
  })

  /**
   * Two rules wanting one book is not hypothetical: a book corrected before
   * #201 can carry two genre tags, and `priority` is what settles it. What the
   * screen owes is both of them, in the order the decision was made.
   */
  it('lists every rule that wanted it, the winner first, with the loser said', async () => {
    await buildWorld()
    const id = await first()

    const applied = await post(`/api/books/${id}/tags`, { slug: 'genre/fiction', label: 'Fiction' })
    expect(applied.status).toBe(201)

    const { body } = await get(`/api/books/${id}/claim`)
    expect(body.claim.claims.map((one: { rule: { name: string }; won: boolean }) =>
      [one.rule.name, one.won])).toEqual([['Fiction', true], ['Non-fiction', false]])
    expect(body.claim.claims[1].why).toContain('tried first')
  })

  /**
   * The state #304 made real: nothing states a genre, no tag is written, and no
   * rule claims the book. Guessing a place for it would file it somewhere
   * nobody asked for and report nothing, so the answer is empty and honest.
   */
  it('survives a book no rule claims at all', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])

    const { status, body } = await get(`/api/books/${id}/claim`)
    expect(status).toBe(200)
    expect(body.claim.claims).toEqual([])
    expect(body.claim.wanted).toBeNull()
    expect(body.claim.tags).toEqual([])
    // It is still standing where somebody put it, which is the point.
    expect(body.claim.standing.label).toBe('4A')
  })

  /** `pinned` beats every rule, forever, and the rule it beats is still named. */
  it('says a book is pinned and still names the rule the pin overrules', async () => {
    await buildWorld()
    const id = await first()
    const bookcase = await nonFiction()

    await new DrizzlePlacementLedger(db).record({
      bookId: id,
      kind: 'pinned',
      areaId: bookcase.areas[2].id,
      sortKey: '',
      actor: 'person',
      reason: 'it lives here',
      createdAt: new Date().toISOString(),
    })

    const { body } = await get(`/api/books/${id}/claim`)
    expect(body.claim.pinned).toBe(true)
    expect(body.claim.standing.label).toBe('4C')
    expect(body.claim.wanted.label).toBe('4A')
    expect(body.claim.claims[0].rule.name).toBe('Non-fiction')
  })

  it('answers nothing for a book this catalogue does not have', async () => {
    await buildWorld()
    const { status, body } = await get('/api/books/999999/claim')
    expect(status).toBe(404)
    expect(body.error).toBe('No such book.')
  })
})

/**
 * Every book no rule claims, which is the list #341 says nothing could answer.
 *
 * The two states are the point. A book carrying no tag at all is what #304 made
 * real, and a book carrying a tag no rule asks for is a different thing that
 * lands in the same place: both are unclaimed, both stand where they were left
 * for good, and the SQL this replaces could only see the first, because it asked
 * `NOT EXISTS` against two hard-coded slugs.
 */
describe('the books no rule claims', () => {
  /** The book at the top of the non-fiction, claimed until a test says otherwise. */
  async function first(): Promise<number> {
    const bookcase = await nonFiction()
    const row = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1',
      [bookcase.areas[0].id],
    )
    return Number(row!.id)
  }

  it('answers an empty list for a room where every book is claimed', async () => {
    await buildWorld()
    const { status, body } = await get('/api/placement/unclaimed')
    expect(status).toBe(200)
    expect(body.books).toEqual([])
    expect(body.total).toBe(0)
  })

  /**
   * The #304 state: nothing stated a genre, so no tag was written. The book is
   * still standing where somebody put it, and saying so is what lets a person
   * walk to it and pick it up.
   */
  it('names a book carrying no tag at all, and says that is why', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(1)
    expect(body.books).toHaveLength(1)
    expect(body.books[0].id).toBe(id)
    expect(body.books[0].why).toBe('untagged')
    expect(body.books[0].tags).toEqual([])
    expect(body.books[0].standing.label).toBe('4A')
  })

  /**
   * The other state, and the one the old inlined SQL could not see: the book
   * carries a tag, so a check for a missing genre tag finds nothing wrong with
   * it, and no rule in this room asks for what it carries.
   */
  it('names a book carrying a tag no rule asks for, and says that is why', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    const applied = await post(`/api/books/${id}/tags`, { slug: 'Poetry', label: 'Poetry' })
    expect(applied.status).toBe(201)

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(1)
    expect(body.books[0].id).toBe(id)
    expect(body.books[0].why).toBe('unmatched')
    expect(body.books[0].tags).toEqual(['Poetry'])
  })

  /** A tag is read by its label, so no slug may reach anybody. */
  it('carries no slug out to anybody', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    await post(`/api/books/${id}/tags`, { slug: 'genre/poetry', label: 'Poetry' })

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(1)
    expect(JSON.stringify(body)).not.toMatch(/genre\//)
  })

  /**
   * A rule somebody switched off files nothing today, so its books are in here.
   *
   * Deliberately the opposite of what `GET /api/books/:id/claim` does with the
   * switch. Explaining one book, "a rule wants it and you turned it off" is
   * worth saying, so a disabled rule is still listed there. Answering which
   * books nothing files, a rule that is off is a rule that files nothing, and
   * `claim` is what says so in both places.
   */
  it('holds every book of a rule somebody switched off', async () => {
    const ids = await buildWorld()
    await db.run("UPDATE placement_rule SET enabled = false WHERE name = 'Non-fiction'")

    const { body } = await get('/api/placement/unclaimed')
    // Every book but the one fiction title, which its own rule still claims.
    expect(body.total).toBe(ids.length - 1)
    expect(body.books.every((one: { why: string }) => one.why === 'unmatched')).toBe(true)
  })

  /**
   * A book that has left the collection is not work. No rule places a withdrawn
   * book by design, which the claim screen already says out loud, so counting
   * one here would be a number that trains somebody to ignore the list.
   */
  it('leaves out a book that has left the collection', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    await db.run("UPDATE books SET state = 'withdrawn' WHERE id = ?", [id])

    const { body } = await get('/api/placement/unclaimed')
    expect(body.books).toEqual([])
    expect(body.total).toBe(0)
  })

  /** A book still waiting in the queue is not here either: the queue is its screen. */
  it('leaves out a book nobody has catalogued yet', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    await db.run("UPDATE books SET state = 'identified' WHERE id = ?", [id])

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(0)
  })
})
