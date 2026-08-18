/**
 * Changing what a place allows, driven over real HTTP against a room with books
 * in it.
 *
 * **Books in it is the point**, the same as in `furniture.routes.test.ts`: every
 * one of these has a trivial answer on an empty catalogue and a real one on
 * somebody's. What is being proved is not that a row can be written. It is the
 * four promises the feature is made of:
 *
 * - **the plan writes nothing**, so a rule stays a draft on the screen until
 *   somebody has read what it would do;
 * - **the plan and the write are the same answer**, so what was approved is what
 *   is recorded;
 * - **nothing is quietly left out**, and a pinned book is counted with the
 *   reason beside it rather than subtracted from the headline;
 * - **applying moves no book**, because a book moves when a person carries it.
 *
 * A rule with no lines is checked here rather than only in the domain, because
 * the whole reason it claims nothing is to make a half-built rule safe, and
 * "safe" means safe over a real catalogue with a real ledger under it.
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
 * fiction books elsewhere, and a tag somebody applied by hand to three of them.
 *
 * The hand-applied tag is what makes this catalogue able to answer the owner's
 * question at all. "Only comic books and fiction" is a rule about two tags, and
 * a catalogue whose only vocabulary is the genre a lookup stated can only ever
 * be asked one question.
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
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
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
    // And it is a real answer rather than an empty one: something would move.
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
    // Two lines and both have to hold: three books carry the tag and one of
    // those three is fiction, so the rule reaches two of them.
    expect(body.plan.claiming).toBe(2)
  })

  /**
   * A rule with nothing in it is a real state, and the one this feature would
   * be dangerous without.
   *
   * "All of no conditions hold" is true, so an empty rule would take the whole
   * catalogue if `domain/placement/rules.ts` let it. It does not, and this is
   * that promise held over a real catalogue rather than over a list of two
   * rules in a unit test: nothing is claimed, and the phrase says so.
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
   * #391: a draft with no rules on a place with no rules is not a change, and
   * the screen had no way to tell that from a rule nothing carries.
   *
   * The usability baseline walked into it. Somebody opened the editor on a plank
   * that files by overflow, added nothing, asked what would move, read a
   * sentence about tags nothing carries, pressed "Write it down" and was told
   * "Nothing changed about where the books belong". Every step of that was
   * truthful and the sequence read as an afternoon's work being lost.
   *
   * `already` beside `names` is the pair that tells the two apart, and the write
   * is unchanged: it wrote nothing then and it writes nothing now, because there
   * was nothing to write.
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

  it('refuses a tag the vocabulary has never heard of', async () => {
    const piece = await nonFiction()
    const { status, body } = await post('/api/placement/rule/plan', {
      about: 'area',
      placeId: piece.areas[1].id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: 'subject/nothing-like-this' }] }],
    })

    expect(status).toBe(400)
    expect(body.error).toMatch(/tag you already have/)
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
   * And every other read still answers in labels only.
   *
   * `furniture.routes.test.ts` holds this over `/api/fixtures` and over
   * `/api/books/:id/claim` for the rules the migration wrote. It is worth
   * holding over a rule somebody wrote themselves as well, because that is the
   * path that did not exist when those two were written and it is the one that
   * nearly put an identity on every reading screen in the app.
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

    // The area now says what it allows, in its own words, on the next read.
    const after = await nonFiction()
    expect(after.areas[1].holds).toBe('Anything tagged Comic books')
    expect(after.areas[1].rule.name).toBe('Comic books')
  })

  /**
   * Applying records where the rules want each book. **It carries nothing.**
   *
   * `placed` is where somebody last said a book was, and only a person standing
   * in front of it changes that. This is the invariant every other part of the
   * app leans on, so it is asserted on the rows rather than inferred.
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
   * A rule written on a place that had none, which is how a person starts.
   *
   * The row does not exist until this call, and it is created pointing at the
   * area rather than at the piece: `placement_rule` names exactly one of them
   * and the database check constraint is the guard.
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
      { operator: 'is', tag: 'Comic books' },
    ])
  })

  /**
   * Taking every line off is allowed, and the area then says so plainly.
   *
   * It is his room. What the app owes him is the truth about what he has just
   * done, which is that nothing files there any more, and not a refusal. This is
   * the state somebody is standing in halfway through swapping one tag for
   * another, so it has to be reachable and it has to be readable.
   */
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
   * Taking the rule off altogether is a different thing from emptying it, and
   * the difference is visible: the piece takes the area back.
   *
   * **A rule somebody takes off is really gone**, which is what makes "or" safe
   * to offer: an alternation you can build and cannot take half of is worse than
   * no alternation. `book_placement.rule_id` is `ON DELETE RESTRICT`, so the
   * reference is let go first, and what a person asks of an assignment still
   * answers, because the reason on the row is the rule's own name.
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

  /**
   * "This tag or that tag": a second rule on the same place.
   *
   * Both name the area, so both open the same stretch and neither can send a
   * book anywhere the other would not. What changes is what the place says it
   * holds, and it says both in one sentence.
   */
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

  /** And one of the two comes off on its own, leaving the other working. */
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

    // Read back the way a screen does, which is the one route that speaks
    // identities, and hand one of the two straight back with the other left out.
    const { body } = await get(`/api/placement/rule?about=area&placeId=${area}`)
    const [first, second] = body.rules
    await post('/api/placement/rule', { about: 'area', placeId: area, rules: [second] })

    const after = await nonFiction()
    expect(after.areas[1].own.map((one: { id: number }) => one.id)).toEqual([second.id])
    expect(after.areas[1].holds).toBe('Anything tagged Non-fiction')
    expect(await db.all('SELECT id FROM placement_rule WHERE id = ?', [first.id])).toEqual([])
  })

  /**
   * Two rules reach one area and the one about the smaller place wins there.
   *
   * What is worth pinning is the half that surprised whoever wrote this: an area
   * rule **opens a stretch**, so the areas after it on the same piece carry on
   * under it rather than under the piece's rule. That is `runFrom` doing exactly
   * what it has always done, and it is why the plan says the area stops taking
   * overflow and the areas after it come with it.
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
