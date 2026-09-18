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
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { TagSlug } from '../domain/tagging/tags'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves
let app: BookScanApp
let server: Server
let baseUrl: string
/** The session every request in this file carries. See server/testauth.ts. */
let cookie: string
let scratch: string
let coverDir: string

/** The tag the owner's own words reach for: "only books with the tag comic books". */
const COMICS = TagSlug.of('subject/comic-books')

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
 * A room: eight non-fiction books cut into three areas on one bookcase, two
 * fiction books elsewhere, and a tag applied by hand to three of them, which
 * is what lets a rule combine a tag with a genre.
 */
async function buildWorld(): Promise<number[]> {
  const ids: number[] = []
  for (let at = 0; at < 8; at += 1) ids.push(await shelve(draft(at)))
  ids.push(await shelve(draft(100, FICTION_SLUG)))
  ids.push(await shelve(draft(101, FICTION_SLUG)))

  const tags = new DrizzleTagRepository(db)
  await tags.define(COMICS, 'Comic books')
  for (const id of [ids[0]!, ids[1]!, ids[8]!]) {
    await tags.apply(id, [{
      slug: COMICS,
      source: 'person',
      confidence: 'high',
      addedAt: new Date().toISOString(),
    }])
  }

  const run = await shelves.layout('nonfiction')
  const separators = new DrizzleSeparatorRepository(db)
  for (const [position, first] of [3, 6].entries()) {
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
      : { body: JSON.stringify(body) }),
    // Every route under /api is behind the gate, so a request without a
    // session cookie is refused 401.
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  })
  return { status: response.status, body: await response.json() }
}

const get = (path: string) => call('GET', path)
const post = (path: string, body: unknown) => call('POST', path, body)

/** The room as the app describes it, which is where every label comes from. */
async function room() {
  const { body } = await get('/api/fixtures')
  return body
}

/** The bookcase the non-fiction books stand on, cut into three areas. */
async function nonFiction() {
  const { fixtures } = await room()
  return fixtures.find((one: { areas: unknown[] }) => one.areas.length === 3)
}

/** Every line of every rule, so a test can prove the plan wrote none of them. */
const everyLine = (): Promise<{ rule_id: number; operator: string; value: string }[]> =>
  db.all('SELECT rule_id, operator, value FROM rule_condition ORDER BY id')

const everyPlacement = (): Promise<{ id: number }[]> =>
  db.all('SELECT id FROM book_placement ORDER BY id')

beforeAll(() => {
  scratch = scratchRoot('placerule')
})

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
  await buildWorld()

  coverDir = mkdtempSync(join(scratch, 'placerule-test-'))
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

describe('planning a change to what a place allows', () => {
  it('writes nothing at all, which is what lets the rule stay a draft', async () => {
    const piece = await nonFiction()
    const linesBefore = await everyLine()
    const placementsBefore = await everyPlacement()

    const { status, body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    expect(status).toBe(200)
    expect(await everyLine()).toEqual(linesBefore)
    expect(await everyPlacement()).toEqual(placementsBefore)
    expect(body.plan.claiming).toBe(3)
  })

  it('says what the place would hold, in the words a person reads', async () => {
    const piece = await nonFiction()
    const { body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{
        id: null,
        conditions: [
          { operator: 'is', tag: COMICS.value },
          { operator: 'is', tag: NON_FICTION_SLUG },
        ],
      }],
    })

    expect(body.plan.holds).toBe('Anything tagged Comic books and tagged Non-fiction')
    expect(body.plan.names).toEqual(['Comic books and Non-fiction'])
    // Three books carry the tag but one of them is fiction, so the rule
    // (comics and non-fiction) reaches two.
    expect(body.plan.claiming).toBe(2)
  })

  /**
   * An empty rule does not claim everything, even though "all of no
   * conditions hold" is vacuously true: `domain/placement/rules.ts` refuses
   * to let it.
   */
  it('claims nothing when it asks for nothing, and says which of the two that is', async () => {
    const piece = await nonFiction()
    const { body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [],
    })

    expect(body.plan.claiming).toBe(0)
    expect(body.plan.holds).toBe('Nothing files here yet')
  })

  /**
   * `already` alongside `names` is what tells a no-op draft from a real
   * change; the write itself is unchanged, since there is nothing to write
   * either way.
   */
  it('says how many rules the place holds today, beside how many it would', async () => {
    const piece = await nonFiction()
    const bare = piece.areas[1].id

    const { body: nothingYet } = await post('/api/placement/rule/plan', {
      about: 'area', placeId: bare, rules: [],
    })
    expect(nothingYet.plan).toEqual(expect.objectContaining({ names: [], already: 0 }))

    await post('/api/placement/rule', {
      about: 'area',
      placeId: bare,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    const { body: takingItOff } = await post('/api/placement/rule/plan', {
      about: 'area', placeId: bare, rules: [],
    })
    expect(takingItOff.plan).toEqual(expect.objectContaining({ names: [], already: 1 }))
  })

  it('writes nothing at all for a draft that is not a change, and says so', async () => {
    const piece = await nonFiction()
    const before = await everyLine()
    const placements = await everyPlacement()

    const { body } = await post('/api/placement/rule', {
      about: 'area', placeId: piece.areas[1].id, rules: [],
    })

    expect(body.wrote.assigned).toBe(0)
    expect(await everyLine()).toEqual(before)
    expect(await everyPlacement()).toEqual(placements)
    expect((await nonFiction()).areas[1].own).toEqual([])
  })

  /**
   * An area gaining its first rule stops taking what overflows from the area
   * before it, and that is the one consequence no count in the plan carries.
   */
  it('says when an area gains its first rule and so stops taking overflow', async () => {
    const piece = await nonFiction()
    const { body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[2].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    expect(body.plan.opens).toBe(true)
  })

  /**
   * `pinned` beats every rule forever, and a plan that quietly dropped one
   * would be believed.
   */
  it('counts a pinned book as left alone rather than as one to carry', async () => {
    const piece = await nonFiction()
    const [standing] = await db.all<{ book_id: number; area_id: number }>(
      `SELECT book_id, area_id FROM book_placement
        WHERE kind = 'placed' AND area_id = ? ORDER BY id LIMIT 1`,
      [piece.areas[0].id],
    )
    await db.run(
      `INSERT INTO book_placement (book_id, kind, area_id, sort_key, actor, reason, created_at)
       SELECT ?, 'pinned', ?, sort_key, 'person', 'stays here', ?
         FROM catalogued_books WHERE id = ?`,
      [standing!.book_id, standing!.area_id, new Date().toISOString(), standing!.book_id],
    )

    const { body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    const pinned = body.plan.skipped.find((one: { reason: string }) => one.reason === 'pinned')
    expect(pinned.books).toHaveLength(1)
    expect(body.plan.groups.flatMap((group: { books: unknown[] }) => group.books)
      .map((book: { id: number }) => book.id))
      .not.toContain(standing!.book_id)
  })

  /**
   * A line may name a word (a label the slug is worked out from); it may not
   * quote a slug identity directly, which is a request no screen in this app
   * makes.
   */
  it('refuses a tag the vocabulary has never heard of and nobody named', async () => {
    const piece = await nonFiction()
    const { status, body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: 'subject/nothing-like-this' }] }],
    })

    expect(status).toBe(400)
    expect(body.error).toMatch(/a word you name here/)
  })

  it('refuses a place that is not there', async () => {
    const { status } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: 99999,
      rules: [],
    })

    expect(status).toBe(404)
  })
})

describe('reading the rules on a place, which is the one read that speaks slugs', () => {
  it('answers the rules in the shape they go back in', async () => {
    const piece = await nonFiction()
    const area = piece.areas[1].id

    await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [{ id: null, conditions: [{ operator: 'under', tag: COMICS.value }] }],
    })

    const { status, body } = await get(`/api/placement/rule?about=area&placeId=${area}`)
    expect(status).toBe(200)
    expect(body.rules).toHaveLength(1)
    expect(body.rules[0].id).toEqual(expect.any(Number))
    expect(body.rules[0].conditions).toEqual([{ operator: 'under', tag: COMICS.value }])
  })

  it('answers an empty list for a place nothing is written on', async () => {
    const piece = await nonFiction()
    const { body } = await get(`/api/placement/rule?about=area&placeId=${piece.areas[2].id}`)
    expect(body.rules).toEqual([])
  })

  it('refuses an id that names nothing', async () => {
    expect((await get('/api/placement/rule?about=area&placeId=nope')).status).toBe(404)
  })

  /**
   * The same guarantee `furniture.routes.test.ts` holds for `/api/fixtures`
   * and `/api/books/:id/claim`, held here for a rule somebody wrote
   * themselves.
   */
  it('leaves the identity out of every other read, on a rule somebody wrote', async () => {
    const piece = await nonFiction()
    await post('/api/placement/rule', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    const { body } = await get('/api/fixtures')
    expect(JSON.stringify(body)).not.toMatch(/subject\//)
    expect(JSON.stringify(body)).not.toMatch(/genre\//)
  })
})

describe('applying a change to what a place allows', () => {
  it('writes the lines and the assignments, and answers the plan it applied', async () => {
    const piece = await nonFiction()
    const area = piece.areas[1].id

    const planned = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: area,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })
    const applied = await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    expect(applied.status).toBe(200)
    // What was approved is what was recorded: the same function answered both.
    expect(applied.body.plan.moving).toBe(planned.body.plan.moving)
    expect(applied.body.plan.holds).toBe(planned.body.plan.holds)

    const lines = await everyLine()
    expect(lines.filter((line) => line.value === COMICS.value)).toHaveLength(1)

    const after = await nonFiction()
    expect(after.areas[1].holds).toBe('Anything tagged Comic books')
    expect(after.areas[1].rule.name).toBe('Comic books')
  })

  /**
   * Applying records where the rules want each book; it does not move any
   * book. `placed` is where somebody last said a book was, and only a person
   * standing in front of it changes that.
   */
  it('moves no book, and says where the rules now want them instead', async () => {
    const piece = await nonFiction()
    const placedBefore = await db.all(
      "SELECT book_id, area_id FROM book_placement WHERE kind = 'placed' ORDER BY id",
    )

    const { body } = await post('/api/placement/rule', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    expect(body.wrote.assigned).toBeGreaterThan(0)
    expect(await db.all(
      "SELECT book_id, area_id FROM book_placement WHERE kind = 'placed' ORDER BY id",
    )).toEqual(placedBefore)
  })

  it('is safe to apply twice, and the second time writes nothing', async () => {
    const piece = await nonFiction()
    const change = {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    }

    const first = await post('/api/placement/rule', change)
    const second = await post('/api/placement/rule', change)

    expect(first.body.wrote.assigned).toBeGreaterThan(0)
    expect(second.body.wrote.assigned).toBe(0)
    expect((await everyLine()).filter((line) => line.value === COMICS.value)).toHaveLength(1)
  })

  /**
   * The row does not exist until this call, and it is created pointing at the
   * area rather than at the piece: `placement_rule` names exactly one of
   * them, and the database check constraint is the guard.
   */
  it('writes a rule on a place that never had one', async () => {
    const piece = await nonFiction()
    const area = piece.areas[2].id
    expect((await nonFiction()).areas[2].rule?.about).not.toBe('area')

    await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    const after = await nonFiction()
    expect(after.areas[2].rule.about).toBe('area')
    expect(after.areas[2].rule.placeId).toBe(area)
    expect(after.areas[2].rule.conditions).toEqual([
      { operator: 'is', tag: 'Comic books', carried: 3 },
    ])
  })

  it('lets a rule be emptied, and the place says it claims nothing', async () => {
    const piece = await nonFiction()
    const area = piece.areas[1].id

    await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })
    const { body: reading } = await get(`/api/placement/rule?about=area&placeId=${area}`)
    const written = reading.rules[0].id
    await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [{ id: written, conditions: [] }],
    })

    const after = await nonFiction()
    expect(after.areas[1].holds).toBe('Nothing files here yet')
    expect(after.areas[1].own[0].conditions).toEqual([])
    expect(await db.all('SELECT id FROM rule_condition WHERE value = ?', [COMICS.value]))
      .toEqual([])
  })

  /**
   * `book_placement.rule_id` is `ON DELETE RESTRICT`, so the reference must
   * be let go before the rule row itself is deleted; the reason recorded on
   * the placement row is the rule's own name, which still reads afterward.
   */
  it('gives the area back to the piece when its own rule is taken off', async () => {
    const piece = await nonFiction()
    const area = piece.areas[1].id

    await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })
    await post('/api/placement/rule', { about: 'area', placeId: area, rules: [] })

    const after = await nonFiction()
    expect(after.areas[1].own).toEqual([])
    expect(after.areas[1].rule.about).toBe('fixture')
    expect(await db.all('SELECT id FROM placement_rule WHERE area_id = ?', [area])).toEqual([])
  })

  it('takes a second rule on one place, and says both in one sentence', async () => {
    const piece = await nonFiction()
    const area = piece.areas[1].id

    await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [
        { id: null, conditions: [{ operator: 'is', tag: COMICS.value }] },
        { id: null, conditions: [{ operator: 'is', tag: NON_FICTION_SLUG }] },
      ],
    })

    const after = await nonFiction()
    expect(after.areas[1].own).toHaveLength(2)
    expect(after.areas[1].holds)
      .toBe('Anything tagged Comic books, or anything tagged Non-fiction')
  })

  it('takes one of two off and leaves the other claiming', async () => {
    const piece = await nonFiction()
    const area = piece.areas[1].id

    await post('/api/placement/rule', {
      about: 'area',
      placeId: area,
      rules: [
        { id: null, conditions: [{ operator: 'is', tag: COMICS.value }] },
        { id: null, conditions: [{ operator: 'is', tag: NON_FICTION_SLUG }] },
      ],
    })

    // Read back the way a screen does: the one route that speaks identities.
    const { body } = await get(`/api/placement/rule?about=area&placeId=${area}`)
    const [first, second] = body.rules
    await post('/api/placement/rule', { about: 'area', placeId: area, rules: [second] })

    const after = await nonFiction()
    expect(after.areas[1].own.map((one: { id: number }) => one.id)).toEqual([second.id])
    expect(after.areas[1].holds).toBe('Anything tagged Non-fiction')
    expect(await db.all('SELECT id FROM placement_rule WHERE id = ?', [first.id])).toEqual([])
  })

  /**
   * An area rule opens a stretch, so the areas after it on the same piece
   * carry on under it rather than under the piece's rule. That is `runFrom`
   * doing what it always does.
   */
  it('opens a stretch at the area, which the areas after it carry on', async () => {
    const piece = await nonFiction()

    await post('/api/placement/rule', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value }] }],
    })

    const after = await nonFiction()
    expect(after.areas[0].rule.about).toBe('fixture')
    expect(after.areas[1].rule.about).toBe('area')
    expect(after.areas[2].rule.about).toBe('area')
    expect(after.areas[2].holds).toBe('Comic books, carrying on')
  })
})

describe('naming a word where the rule is written', () => {
  /** What the screen sends: the label somebody typed, and the slug it makes. */
  const MANGA = { operator: 'is' as const, tag: 'subject/manga', label: 'Manga' }

  const tagRows = (): Promise<{ slug: string; label: string }[]> =>
    db.all('SELECT slug, label FROM tag ORDER BY slug')

  it('plans a rule for a word nothing carries, and writes no tag doing it', async () => {
    const piece = await nonFiction()
    const before = await tagRows()

    const { status, body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [MANGA] }],
    })

    expect(status).toBe(200)
    // The phrase reads off the word somebody typed rather than falling back
    // to the rule's own name, which is what a slug with no row behind it
    // would do.
    expect(body.plan.holds).toBe('Anything tagged Manga')
    expect(body.plan.names).toEqual(['Manga'])
    expect(body.plan.claiming).toBe(0)
    expect(body.plan.opens).toBe(true)
    expect(body.plan.moving).toBeGreaterThan(0)
    expect(await tagRows()).toEqual(before)
  })

  it('writes the word and the rule in one press, and the rule then waits', async () => {
    const piece = await nonFiction()

    const { status } = await post('/api/placement/rule', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [MANGA] }],
    })
    expect(status).toBe(200)

    expect(await tagRows()).toContainEqual({ slug: 'subject/manga', label: 'Manga' })

    const after = await nonFiction()
    expect(after.areas[1].holds).toBe('Anything tagged Manga')
    expect(after.areas[1].rule.conditions).toEqual([
      { operator: 'is', tag: 'Manga', carried: 0 },
    ])
  })

  /**
   * The count beside the line comes from the same rollup the tags screen
   * counts with, which is what turns "waiting" into "filing" the moment a
   * book carries the word.
   */
  it('stops waiting when a book carries the word', async () => {
    const piece = await nonFiction()
    await post('/api/placement/rule', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [MANGA] }],
    })

    const [book] = await db.all<{ id: number }>(
      'SELECT id FROM catalogued_books ORDER BY id LIMIT 1',
    )
    await post(`/api/books/${book!.id}/tags`, { slug: 'subject/manga', label: 'Manga' })

    const after = await nonFiction()
    expect(after.areas[1].rule.conditions).toEqual([
      { operator: 'is', tag: 'Manga', carried: 1 },
    ])
  })

  /**
   * A word arriving through a placement rule goes through the same fold as a
   * word arriving through a book (`domain/tagging/naming.ts`), so two
   * spellings of one tag do not become two rows.
   */
  it('refuses a second spelling of a word the collection already keeps', async () => {
    const piece = await nonFiction()
    const before = await tagRows()

    const { status, body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{
        id: null,
        conditions: [{ operator: 'is', tag: 'subject/comic-book', label: 'Comic Book' }],
      }],
    })

    expect(status).toBe(400)
    expect(body.error).toMatch(/one tag rather than two/)
    expect(await tagRows()).toEqual(before)
  })

  it('refuses to make a second Fiction, and points at the one there is', async () => {
    const piece = await nonFiction()

    const { status, body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{
        id: null,
        conditions: [{ operator: 'is', tag: 'subject/fiction', label: 'Fiction' }],
      }],
    })

    expect(status).toBe(400)
    expect(body.error).toMatch(/Fiction and non-fiction are tags you already have/)
  })

  /**
   * The slug is checked against the server's own answer rather than trusted
   * from the request, or `NAMED_UNDER` would be a suggestion rather than a
   * rule: a tag under nothing is a tag no existing rule can reach.
   */
  it('refuses a word asked for under a heading of the caller\'s choosing', async () => {
    const piece = await nonFiction()

    const { status, body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{
        id: null,
        conditions: [{ operator: 'is', tag: 'genre/manga', label: 'Manga' }],
      }],
    })

    expect(status).toBe(400)
    expect(body.error).toMatch(/written under subject/)
  })

  it('is safe to apply twice and leaves one word behind, not two', async () => {
    const piece = await nonFiction()

    await post('/api/placement/rule', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [MANGA] }],
    })
    const [rule] = await db.all<{ id: number }>(
      'SELECT id FROM placement_rule ORDER BY id DESC LIMIT 1',
    )
    await post('/api/placement/rule', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: rule!.id, conditions: [{ operator: 'is', tag: 'subject/manga' }] }],
    })

    expect((await tagRows()).filter((one) => one.slug === 'subject/manga'))
      .toEqual([{ slug: 'subject/manga', label: 'Manga' }])
  })
})

describe('two places asking for one tag, which is allowed and was silent', () => {
  it('names the place already asking for these books when its rule wins', async () => {
    const piece = await nonFiction()
    const { body: added } = await post('/api/fixtures', { kind: 'bookshelf' })
    await post(`/api/fixtures/${added.fixture.id}/areas`, {})

    const { body } = await post('/api/placement/rule/plan', {
      about: 'fixture',
      placeId: added.fixture.id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: 'genre/non-fiction' }] }],
    })

    expect(body.plan.moving).toBe(0)
    expect(body.plan.claiming).toBe(8)
    expect(body.plan.alsoClaims).toEqual([{ place: piece.label, books: 8, keeps: 8 }])
  })

  /**
   * The preview counts books whose label did not change; the engine counts
   * books whose area did. Two pieces standing on one number is what could
   * pull those apart, in an arrangement `slotsInOrder` produces for this
   * catalogue.
   */
  it('previews the same number of books the write then assigns', async () => {
    const piece = await nonFiction()
    const { body: added } = await post('/api/fixtures', {
      kind: 'bookshelf', position: piece.position,
    })
    const { body: plank } = await post(`/api/fixtures/${added.fixture.id}/areas`, {})

    // An area rule, because `claim` tries an area before a piece: this is the
    // twin bookcase actually taking the books rather than losing to the
    // piece's own rule.
    expect(plank.area.label).toBe(piece.areas[0].label)

    const draftRule = {
      about: 'area',
      placeId: plank.area.id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: 'genre/non-fiction' }] }],
    }

    const { body: planned } = await post('/api/placement/rule/plan', draftRule)
    const { body: applied } = await post('/api/placement/rule', draftRule)

    expect(planned.plan.moving).toBe(8)
    // The two fiction books, which no part of this is about.
    expect(planned.plan.staying).toBe(2)
    expect(applied.wrote.assigned).toBe(planned.plan.moving)
  })
})
