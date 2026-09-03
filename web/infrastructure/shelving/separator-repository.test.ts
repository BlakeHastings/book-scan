/**
 * What a boundary change does to the rows.
 *
 * **This file used to read the SQL and never run it.** Through #213 a boundary
 * was a row in `separators`, `add` was one insert and `remove` was one delete,
 * and the claims worth pinning were about the statement text: that the
 * placeholders came out as `?`, and that the insert did not contain the word
 * `default`. A fake `Db` that recorded rather than executed was the only thing
 * that could say either.
 *
 * Since #232 there is no `separators` table and no statement of that shape. Each
 * method reads the range's boundaries out of the areas, applies one change and
 * writes the areas back, so the interesting claim is not what SQL was generated
 * but which rows are on the floor afterwards: which fixture an area hangs on,
 * what it is anchored at, and, above all, whether an area a book has been placed
 * in survived its boundary being removed. A recording fake cannot answer any of
 * those, because every one of them is the database's answer rather than the
 * repository's.
 *
 * So this runs against a real database, like `server/dividers.test.ts` and
 * `areas.test.ts` beside it. A test database arrives with the two runs already
 * standing, seeded by `0013`: fiction on the fixture at position 1 and
 * non-fiction on the one at position 4, each with a single area at position 0
 * anchored at the empty string.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import type { Db } from '../../server/driver'
import { DrizzleSeparatorRepository } from './separator-repository'
import {
  areaOfKey, areasOf, bandOf, boundariesFrom, runAreasOf, type DerivedArea,
} from './areas'
import { areaDisagreements, describeAreaDisagreement } from './area-drift'
import type { NewSeparator } from '../../application/shelving/ports'
import type { Separator, SeparatorKind } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

let db: Db
let repository: DrizzleSeparatorRepository

beforeEach(async () => {
  db = await openTestDatabase()
  repository = new DrizzleSeparatorRepository(db)
})

afterAll(closeTestDatabase)

const STAMP = '2026-08-09T00:00:00.000Z'

/**
 * A boundary somebody asked for, as the port states one.
 *
 * `position`, `note` and `createdAt` are still on `NewSeparator` and none of
 * them reaches a row. A boundary's position is where its area sits in the run,
 * so it is derived rather than given, and the two text columns belonged to a
 * table that no longer exists. They are passed as the port asks for them and
 * nothing here reads them back.
 */
const asked = (range: ShelfRange, kind: SeparatorKind, startsAt: string): NewSeparator => ({
  range, kind, startsAt, position: 0, note: '', createdAt: STAMP,
})

/** A boundary said as this file reads one: its kind, its anchor, its ordinal. */
const said = (separators: readonly Separator[]) =>
  separators.map((one) => `${one.kind}@${one.startsAt}#${one.position}`)

/** An area said the way `areas.test.ts` says one: bookcase, plank, anchor. */
const drawn = (areas: readonly DerivedArea[]) =>
  areas.map((one) => `${one.fixturePosition}:${one.position}@${one.startsAt}`)

/** Every area standing on the floor, both runs, in the order a book meets them. */
const furniture = () =>
  db.all<{ fixture: number; position: number; starts_at: string }>(
    `SELECT f.position AS fixture, a.position, a.starts_at
       FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE a.position >= 0
      ORDER BY f.position, f.id, a.position`,
  )

/**
 * The walk and the walk back, checked against the rows they describe.
 *
 * Two claims, and the first is the one a fake database could never make: the
 * areas actually written are the areas `areasOf` says the boundaries imply. The
 * second is the identity `boundariesFrom` owes it, taken over real ids: reading
 * those areas back gives the boundaries they were walked from, so a boundary
 * comes out as the boundary that went in.
 */
async function roundTrips(range: ShelfRange): Promise<void> {
  const boundaries = await repository.inRange(range)
  const band = (await bandOf(db, range))!
  const rows = await runAreasOf(db, range)

  const walked = areasOf(band.start, boundaries)
  expect(drawn(rows)).toEqual(drawn(walked))

  const rebuilt = walked.map((area, at) => ({ ...area, id: rows[at]!.id }))
  expect(boundariesFrom(range, rebuilt)).toEqual(boundaries)
}

/**
 * Point the rule that serves a range at one area, or back at a whole bookcase.
 *
 * Which rule that is comes from the tag it asks for, the same pairing
 * `ruleForRange` reads out of `GENRE_RANGES`, so this moves the run's beginning
 * exactly as "Say what belongs here" and "Have no rule here" do on a screen.
 */
async function runOpensAt(
  slug: string,
  at: { area: number } | { fixture: number },
): Promise<void> {
  await db.run(
    `UPDATE placement_rule SET area_id = ?, fixture_id = ?
      WHERE id IN (SELECT rule_id FROM rule_condition WHERE value = ?)`,
    'area' in at ? [at.area, null, slug] : [null, at.fixture, slug],
  )
}

const fictionOpensAt = (at: { area: number } | { fixture: number }) =>
  runOpensAt('genre/fiction', at)

/**
 * A second rule naming a genre, written on one plank.
 *
 * Two rules on one genre is legal and stays legal (#430 item 1), and this is
 * what "say what belongs here" writes on a plank: an area rule beside the
 * fixture rule the migration seeded. `ruleForRange` picks between them by
 * `byPrecedence`, area before fixture, so this one is the one that serves the
 * range from here on and the bookcase rule goes on standing.
 */
async function alsoBelongsHere(slug: string, area: number, name: string): Promise<void> {
  const rule = await db.get<{ id: number }>(
    `INSERT INTO placement_rule (area_id, fixture_id, priority, name, enabled)
     VALUES (?, NULL, 100, ?, TRUE) RETURNING id`,
    [area, name],
  )
  await db.run(
    `INSERT INTO rule_condition (rule_id, field, operator, value)
     VALUES (?, 'tag', 'is', ?)`,
    [rule!.id, slug],
  )
}

/** The id of the bookcase standing at one position. */
async function fixtureAt(position: number): Promise<number> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM fixture WHERE position = ? ORDER BY id LIMIT 1',
    [position],
  )
  return row!.id
}

/** The id of one plank of the bookcase standing at a position. */
async function plankOf(fixture: number, position: number): Promise<number> {
  const row = await db.get<{ id: number }>(
    `SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE f.position = ? AND a.position = ?`,
    [fixture, position],
  )
  return row!.id
}

/** The id of the area a run begins in, which is furniture and not a boundary. */
const firstAreaOf = (fixture: number) => plankOf(fixture, 0)

/**
 * A shelved book carrying the tag its range comes from.
 *
 * The tag is what a rule reads and the column is what the layout reads, so a
 * book needs both before `areaDisagreements` has two answers to compare. The
 * rows are written directly because this file has no save path; `tag` itself is
 * seeded by the migrations.
 */
async function shelve(title: string, range: ShelfRange, sortKey: string): Promise<number> {
  const slug = range === 'fiction' ? 'genre/fiction' : 'genre/non-fiction'
  const book = await db.get<{ id: number }>(
    `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state)
     VALUES (?, ?, ?, ?, 'shelved') RETURNING id`,
    [title, range, sortKey, STAMP],
  )
  await db.run(
    `INSERT INTO book_tag (book_id, tag_id, source, confidence, added_at)
     SELECT ?, id, 'person', 'stated', ? FROM tag WHERE slug = ?`,
    [book!.id, STAMP, slug],
  )
  return book!.id
}

describe('reading a range', () => {
  it('is empty on a run nobody has cut yet', async () => {
    // One area apiece, and the area a run begins in is not a boundary: it opens
    // at the beginning rather than at a book.
    expect(await repository.inRange('fiction')).toEqual([])
    expect(await repository.inRange('nonfiction')).toEqual([])
  })

  it('derives each kind from the bookcase its area hangs on', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'area', 'd'))
    await repository.add(asked('fiction', 'shelf', 'f'))

    // Nothing wrote a kind down. `area` is an area on the same fixture as the
    // one before it and `shelf` is one on the next fixture, which is exactly
    // what the words mean on the furniture.
    expect(said(await repository.inRange('fiction')))
      .toEqual(['area@b#0', 'area@d#1', 'shelf@f#2'])
  })

  it('puts a boundary where its anchor is, not where it was added', async () => {
    await repository.add(asked('fiction', 'area', 'm'))
    await repository.add(asked('fiction', 'area', 'd'))

    expect(said(await repository.inRange('fiction'))).toEqual(['area@d#0', 'area@m#1'])
  })
})

describe('adding a boundary', () => {
  it('gives a plank break the next area of the same bookcase', async () => {
    await repository.add(asked('fiction', 'area', 'b'))

    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('gives a bookcase break a fixture of its own, at its top plank', async () => {
    const before = await db.all<{ position: number }>(
      'SELECT position FROM fixture ORDER BY position',
    )
    expect(before.map((one) => one.position)).toEqual([1, 4])

    await repository.add(asked('fiction', 'shelf', 'd'))

    // A bookcase really is a row: there is a third fixture now, and the new
    // area is the top plank of it rather than the next plank of bookcase 1.
    const after = await db.all<{ position: number }>(
      'SELECT position FROM fixture ORDER BY position',
    )
    expect(after.map((one) => one.position)).toEqual([1, 2, 4])
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 2, position: 0, starts_at: 'd' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('leaves the boundaries of the other range exactly as they were', async () => {
    await repository.add(asked('nonfiction', 'area', 'p'))
    const before = await repository.inRange('nonfiction')

    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))

    // Non-fiction starts on bookcase 4 and fiction has just grown onto bookcase
    // 2, so the two runs still stand one after the other and nothing on the
    // non-fiction shelves moved.
    expect(await repository.inRange('nonfiction')).toEqual(before)
    expect(said(await repository.inRange('fiction'))).toEqual(['area@b#0', 'shelf@d#1'])
  })
})

describe('the areas and the boundaries being two readings of one run', () => {
  it('round-trips what an add wrote', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))
    await repository.add(asked('fiction', 'area', 'f'))
    await repository.add(asked('nonfiction', 'area', 'p'))

    expect(said(await repository.inRange('fiction')))
      .toEqual(['area@b#0', 'shelf@d#1', 'area@f#2'])
    await roundTrips('fiction')
    await roundTrips('nonfiction')
  })

  it('round-trips what a re-anchor wrote', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))

    const [plank] = await repository.inRange('fiction')
    await repository.reanchor(plank!.id, 'c')

    expect(said(await repository.inRange('fiction'))).toEqual(['area@c#0', 'shelf@d#1'])
    await roundTrips('fiction')
  })

  /**
   * **What this asserted before #465 was a bookcase disappearing.**
   *
   * `remove` used to write the boundary list back without one entry and let
   * `areasOf` re-walk it, so taking out a bookcase break folded bookcase 2 into
   * bookcase 1: bookcase 1 grew a plank it had never had, and bookcase 2 was
   * left standing with none. Removing a boundary takes *that area* off the
   * furniture (`docs/shelving.md`), so it is `dropArea` now, and what goes is
   * the plank the boundary opened.
   */
  it('round-trips what a removal wrote', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))
    await repository.add(asked('fiction', 'area', 'f'))

    const boundaries = await repository.inRange('fiction')
    expect(await repository.remove(boundaries[1]!.id)).toEqual({ ok: true })

    // The first plank of bookcase 2 went and the one below it came forward,
    // taking over its anchor: the piece keeps standing, one plank shorter, and
    // the bookcase break is still where the bookcase still starts.
    expect(said(await repository.inRange('fiction'))).toEqual(['area@b#0', 'shelf@d#1'])
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 2, position: 0, starts_at: 'd' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
    await roundTrips('fiction')
  })

  /**
   * The one refusal this method has, and it is new (#465).
   *
   * An area that is the only one on its piece has nothing there for its books
   * to join, so `removeArea` refuses and says what to do instead. The boundary
   * list rewrite had no such answer: it took every plank off the piece and left
   * it standing empty, which is the state #391 and #420 are about.
   */
  it('refuses to take the only plank off a piece, and leaves it standing', async () => {
    await repository.add(asked('fiction', 'shelf', 'd'))

    const [boundary] = await repository.inRange('fiction')
    const refused = await repository.remove(boundary!.id)

    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.error).toMatch(/only one on this piece/)
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 2, position: 0, starts_at: 'd' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })
})

/**
 * #485, at the level the anchor is written.
 *
 * A plank the run happens to open at is still a plank, and the boundary above
 * it is still where it was. Where the run **begins** is the rule's answer, asked
 * through `ruleForRange` and `entryAreaOf`; the anchor says where an area is cut
 * off from the one before it. `writeBoundaries` used to record the first answer
 * in the second place, blanking the anchor of whichever plank the run opened at,
 * and nothing took it back when the rule moved the entry somewhere else.
 *
 * What that left is one press away in the app: give an empty plank a rule, do
 * anything that touches a boundary, then take the rule off again. The plank sat
 * in the middle of the run holding a boundary anchored below every book, both
 * walks that sort boundaries by anchor stepped it first, and the ordinal walk
 * slid a plank along: a board drawn for a plank that does not exist, a bookcase
 * holding twelve books not drawn at all, and three screens counting three
 * different things.
 */
describe('a run that begins at a plank, and then does not', () => {
  /** Bookcase 1 cut once, then bookcase 2 with a plank of its own. */
  const twoBookcases = async (): Promise<void> => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'm'))
    await repository.add(asked('fiction', 'area', 'p'))
  }

  it('leaves the anchor alone while the run opens there', async () => {
    await twoBookcases()
    await fictionOpensAt({ area: await firstAreaOf(2) })

    // An ordinary boundary act, which is what carries a change into the areas.
    await repository.add(asked('fiction', 'area', 'q'))

    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      // The plank the run now opens at. It is still cut off bookcase 1 at `m`,
      // and it says so.
      { fixture: 2, position: 0, starts_at: 'm' },
      { fixture: 2, position: 1, starts_at: 'p' },
      { fixture: 2, position: 2, starts_at: 'q' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('is a boundary again, where it always was, once the run begins earlier', async () => {
    await twoBookcases()
    await fictionOpensAt({ area: await firstAreaOf(2) })
    await repository.add(asked('fiction', 'area', 'q'))

    // "Have no rule here": the run goes back to beginning on bookcase 1.
    await fictionOpensAt({ fixture: await fixtureAt(1) })

    expect(said(await repository.inRange('fiction')))
      .toEqual(['area@b#0', 'shelf@m#1', 'area@p#2', 'area@q#3'])
    await roundTrips('fiction')
  })

  it('files a book onto the plank whose anchor it has passed', async () => {
    await twoBookcases()
    await fictionOpensAt({ area: await firstAreaOf(2) })
    await repository.add(asked('fiction', 'area', 'q'))
    await fictionOpensAt({ fixture: await fixtureAt(1) })

    // `n` is past `m` and short of `p`, so it belongs on the top plank of
    // bookcase 2 and nowhere else. With the anchor blanked, `m` sorted below
    // every key, the walk stepped that boundary before the one at `b`, and this
    // book was filed back onto bookcase 1.
    const run = await runAreasOf(db, 'fiction')
    expect(areaOfKey(run, 'n')?.id).toBe(await firstAreaOf(2))
  })
})

/**
 * #490, which is the same sentence one layer in from #463.
 *
 * #463 made `ruleForRange` the one answer to *which rule* serves a range. Both
 * sides here already ask that rule and then disagree about **what the run
 * derived from it contains**: `bandOf` answers where a run begins as a plank,
 * because `entryAreaOf` resolves the plank the rule points at, and `runAreasOf`
 * read the bookcase out of that answer and threw the plank away.
 *
 * So a run whose entry is not the top plank of its piece came back holding the
 * planks standing before its entry, and called the first of those the plank the
 * run opens at. `docs/shelving.md` settles which of the two is right in one
 * line — "a run runs from its rule's entry area until the next area any rule
 * points at" — and `runFrom` has always read it that way in the domain.
 *
 * The arrangement is the rule editor's own guidance followed on a plank: "say
 * what belongs here" writes an area rule, and two rules naming one genre is
 * legal (#430 item 1). Nothing here makes that state an error.
 */
describe('a run that opens partway down a bookcase', () => {
  /**
   * Fiction cut into five planks over two bookcases, then non-fiction's rule
   * written onto the third plank of the second one.
   *
   * `2A` and `2B` are anchored at real sort keys, which is what makes the old
   * reading visible rather than merely wrong: `areaOfKey` sorts a run by anchor,
   * so two planks the run does not own sorted in front of the one it does.
   */
  const nonfictionOpensAtTheThirdPlank = async (): Promise<void> => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'm'))
    await repository.add(asked('fiction', 'area', 'p'))
    await repository.add(asked('fiction', 'area', 'q'))
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 2, position: 0, starts_at: 'm' },
      { fixture: 2, position: 1, starts_at: 'p' },
      { fixture: 2, position: 2, starts_at: 'q' },
      { fixture: 4, position: 0, starts_at: '' },
    ])

    await alsoBelongsHere('genre/non-fiction', await plankOf(2, 2), 'Non-fiction here')
  }

  it('is the planks from its entry on, not every plank of its bookcase', async () => {
    await nonfictionOpensAtTheThirdPlank()

    expect(drawn(await runAreasOf(db, 'nonfiction'))).toEqual(['2:2@q'])
  })

  it('offers no boundary for the planks standing before its entry', async () => {
    await nonfictionOpensAtTheThirdPlank()

    // A one plank run has nothing above it to be cut off from, so it has no
    // boundaries at all. `2A` and `2B` came back as two of non-fiction's, which
    // is what put a `2D` and a `2E` on the shelves screen that no bookcase has.
    expect(await repository.inRange('nonfiction')).toEqual([])
  })

  it('lands a book on its entry plank rather than on the run before it', async () => {
    await nonfictionOpensAtTheThirdPlank()

    // `pz` is past `2B`'s anchor and short of `2C`'s, so the old reading walked
    // it onto `2B`: a plank inside the run that owns the shelves above. That is
    // the plank the misfile list prints as where the book belongs.
    const run = await runAreasOf(db, 'nonfiction')
    expect(areaOfKey(run, 'pz')?.id).toBe(await plankOf(2, 2))
  })

  it('leaves the planks before it standing, on the face, holding their anchors', async () => {
    await nonfictionOpensAtTheThirdPlank()

    // Nothing is repaired and nothing is taken away. A rule written on `2C` says
    // where non-fiction begins; it says nothing about the two planks above it,
    // and the run they belong to is not this one's business.
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 2, position: 0, starts_at: 'm' },
      { fixture: 2, position: 1, starts_at: 'p' },
      { fixture: 2, position: 2, starts_at: 'q' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  /**
   * The instrument, asked in the arrangement it was silent about.
   *
   * `areaDisagreements` places every shelved book twice and says nothing when
   * the two agree. Its two readings stay independent here on purpose (#488): the
   * layout side walks the areas the boundary list is derived from, the rules
   * side walks `runFrom` over the slots, and making them agree by construction
   * would blind the one check that catches this whole family.
   */
  it('is where the rules put the book, which is what the drift check asks', async () => {
    await nonfictionOpensAtTheThirdPlank()
    await shelve('The Selfish Gene', 'nonfiction', 'pz')

    expect((await areaDisagreements(db)).map(describeAreaDisagreement)).toEqual([])
  })
})

describe('removing a boundary whose area a book has been placed in', () => {
  /**
   * A book is placed in an area, and `book_placement.area_id` is
   * `ON DELETE RESTRICT`, so the row cannot go: the ledger is the record of
   * where books have physically been and deleting the furniture it names would
   * lose it. Leaving the area standing is not an option either, because the run
   * is what the boundary list is derived from, so an area still on the fixture's
   * face comes straight back out of `inRange` as a boundary nobody asked for and
   * the removal never happened.
   *
   * So it is retired instead: taken off the face by giving it a negative
   * position, which every read of the furniture filters out, while the row and
   * every placement naming it stay exactly where they are. That is the case this
   * whole file exists for, and it is invisible to any test that does not put a
   * book somewhere first.
   */
  it('retires the area rather than deleting it, and the boundary stops coming back', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    const [boundary] = await repository.inRange('fiction')
    const areaId = boundary!.id

    const book = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state)
       VALUES ('A Shelved Book', 'fiction', 'B', ?, 'shelved') RETURNING id`,
      [STAMP],
    )
    await db.run(
      `INSERT INTO book_placement (book_id, kind, area_id, sort_key, actor, reason, created_at)
       VALUES (?, 'placed', ?, 'B', 'person', '', ?)`,
      [book!.id, areaId, STAMP],
    )

    await repository.remove(areaId)

    // Gone as far as anything reading the shelves is concerned.
    expect(await repository.inRange('fiction')).toEqual([])
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 4, position: 0, starts_at: '' },
    ])

    // And still there, off the face, with the placement that pinned it intact.
    const retired = await db.get<{ position: number }>(
      'SELECT position FROM area WHERE id = ?',
      [areaId],
    )
    expect(retired?.position).toBeLessThan(0)
    const placement = await db.get<{ area_id: number }>(
      'SELECT area_id FROM book_placement WHERE book_id = ?',
      [book!.id],
    )
    expect(placement?.area_id).toBe(areaId)
  })

  it('deletes the area outright when no book was ever placed in it', async () => {
    // The contrast that makes the retirement a decision rather than the only
    // thing this code can do. Nothing names this area, so nothing keeps it.
    await repository.add(asked('fiction', 'area', 'b'))
    const [boundary] = await repository.inRange('fiction')

    await repository.remove(boundary!.id)

    expect(await repository.inRange('fiction')).toEqual([])
    const found = await db.all<{ id: number }>('SELECT id FROM area WHERE id = ?', [boundary!.id])
    expect(found).toEqual([])
  })
})

describe('which range a boundary is in', () => {
  it('names it, and answers nothing for an id that is not a boundary', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('nonfiction', 'area', 'p'))

    const [fiction] = await repository.inRange('fiction')
    const [nonfiction] = await repository.inRange('nonfiction')
    expect(await repository.rangeOf(fiction!.id)).toBe('fiction')
    expect(await repository.rangeOf(nonfiction!.id)).toBe('nonfiction')

    // The area a run begins in is a real row with a real id and is furniture
    // rather than a boundary, so it is the sharp case: an id that exists and
    // names nothing anybody can remove.
    expect(await repository.rangeOf(await firstAreaOf(1))).toBeUndefined()
    expect(await repository.rangeOf(await firstAreaOf(4))).toBeUndefined()
    expect(await repository.rangeOf(999_999)).toBeUndefined()
  })
})

/**
 * #499, which is #490 read at the other end of the same answer.
 *
 * #490 fixed where a band **begins**: `bandOf` answers with a plank and
 * `runAreasOf` reads the plank. The band's other end was a bookcase and stays
 * one for the reader it belongs to, because a move stops one piece earlier than
 * a run does (#420) and that is a decision rather than an untidiness.
 *
 * The mistake was never the asymmetry. It was that one number stood for both
 * answers, so "which planks is this run" was put to the bound that exists to say
 * which *bookcases* a move may pick up, and two states nobody chose came out of
 * it. Both are reached through the rule editor's own guidance, both are
 * arrangements #430 item 1 deliberately keeps legal, and the band now carries
 * `end` for the run and `limit` for the move so each caller says which it is
 * asking for.
 */
describe('a run that stops part way down a bookcase', () => {
  /**
   * Fiction over two bookcases with non-fiction's rule on the third plank of the
   * second, which leaves `2A` and `2B` flowing on from fiction.
   *
   * `runFrom` has always given those two to fiction: a run runs from its rule's
   * entry area until the next area any rule points at, and the next such area is
   * `2C`. The band stopped at bookcase 2 entire, so they belonged to nobody.
   */
  const fictionRunsOntoNonfictionsBookcase = async (): Promise<void> => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'm'))
    await repository.add(asked('fiction', 'area', 'p'))
    await repository.add(asked('fiction', 'area', 'q'))
    await alsoBelongsHere('genre/non-fiction', await plankOf(2, 2), 'Non-fiction here')
  }

  it('runs on to the plank before the next entry, not to the bookcase before it', async () => {
    await fictionRunsOntoNonfictionsBookcase()

    // `2A` and `2B` are fiction's, because a run stops at an area and the next
    // area a rule points at is `2C`. The bookcase bound dropped both.
    expect(drawn(await runAreasOf(db, 'fiction'))).toEqual([
      '1:0@', '1:1@b', '2:0@m', '2:1@p',
    ])
  })

  it('keeps the cuts somebody made on those planks', async () => {
    await fictionRunsOntoNonfictionsBookcase()

    // Three boundaries went in and three come back. Bounding at the bookcase
    // answered one, so the shelf cut onto `2A` and the cut at `2B` were offered
    // by no read and could be acted on by nobody.
    expect(said(await repository.inRange('fiction'))).toEqual([
      'area@b#0', 'shelf@m#1', 'area@p#2',
    ])
  })

  it('lands a book on the plank flowing on from the run, not on the one before', async () => {
    await fictionRunsOntoNonfictionsBookcase()

    // `mm` is past `2A`'s anchor and short of `2B`'s, so `runFrom` and `areaFor`
    // put it on `2A`. The band ended fiction's run at `1B`, so the layout drew
    // it there instead, which is the drift below said one book at a time.
    const run = await runAreasOf(db, 'fiction')
    expect(areaOfKey(run, 'mm')?.id).toBe(await plankOf(2, 0))
  })

  it('leaves the next run\'s entry plank standing when this run gives one up', async () => {
    await fictionRunsOntoNonfictionsBookcase()

    // The cut at `p` is dragged up above the one onto bookcase 2, which is one
    // reanchor and leaves fiction with one plank on that piece instead of two.
    // So bookcase 2 is half inside this run and half outside it, which is the
    // shape `writeBoundaries` had no bound for at this end: `2B` is fiction's to
    // give up and `2C`, a plank standing past everything fiction derives and
    // holding somebody's rule, is not fiction's to take off the face.
    await repository.reanchor(await plankOf(2, 1), 'c')

    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 1, position: 2, starts_at: 'c' },
      { fixture: 2, position: 0, starts_at: 'm' },
      { fixture: 2, position: 2, starts_at: 'q' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('puts the book where the rules put it, which is what the drift check asks', async () => {
    await fictionRunsOntoNonfictionsBookcase()
    await shelve('Wolf Hall', 'fiction', 'mm')

    expect((await areaDisagreements(db)).map(describeAreaDisagreement)).toEqual([])
  })
})

/**
 * The worse of the two, and the one with no symptom at all.
 *
 * Two runs beginning on one bookcase made the earlier band's limit and its start
 * the same number, so `runAreasOf` asked for `f.position >= 1 AND f.position < 1`
 * and fiction came back with no run. Not an error and not a warning: a range
 * that simply was not there, with the planks somebody had cut still standing on
 * the bookcase and every book drawn on the first of them.
 *
 * The arrangement is one press of "say what belongs here" on a plank of a
 * bookcase a run already opens on. #430 item 1 keeps that legal and #463, #486,
 * #490 and this all rest on it, so nothing here refuses it.
 */
describe('two runs beginning on one bookcase', () => {
  const nonfictionOpensAtTheThirdPlankOfFictionsBookcase = async (): Promise<void> => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'area', 'c'))
    await alsoBelongsHere('genre/non-fiction', await plankOf(1, 2), 'Non-fiction here')
  }

  it('leaves the earlier range a run, bounded at the later one\'s plank', async () => {
    await nonfictionOpensAtTheThirdPlankOfFictionsBookcase()

    expect(drawn(await runAreasOf(db, 'fiction'))).toEqual(['1:0@', '1:1@b'])
    expect(drawn(await runAreasOf(db, 'nonfiction'))).toEqual(['1:2@c'])
  })

  it('leaves the earlier range its boundaries', async () => {
    await nonfictionOpensAtTheThirdPlankOfFictionsBookcase()

    // One cut, at `b`, which is the one still fiction's. With no run there was
    // no boundary list either, so the shelves screen drew every fiction book on
    // `1A` and offered nothing that could move any of them.
    expect(said(await repository.inRange('fiction'))).toEqual(['area@b#0'])
  })

  it('lands a book on a plank of the run rather than on nothing at all', async () => {
    await nonfictionOpensAtTheThirdPlankOfFictionsBookcase()

    const run = await runAreasOf(db, 'fiction')
    expect(areaOfKey(run, 'bb')?.id).toBe(await plankOf(1, 1))
  })

  it('leaves the later run\'s plank standing when the earlier one is written', async () => {
    await nonfictionOpensAtTheThirdPlankOfFictionsBookcase()

    // A boundary act on fiction, which reconciles fiction's areas. `1C` stands
    // on the piece fiction opens on and is not fiction's, so nothing here may
    // take it off the face — the same claim #490 made about `2A` and `2B`, at
    // the other end of the run.
    await repository.add(asked('fiction', 'area', 'bb'))

    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 1, position: 2, starts_at: 'c' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('puts every book where the rules put it, which is what the drift check asks', async () => {
    await nonfictionOpensAtTheThirdPlankOfFictionsBookcase()
    await shelve('Wolf Hall', 'fiction', 'bb')
    await shelve('The Selfish Gene', 'nonfiction', 'cc')

    expect((await areaDisagreements(db)).map(describeAreaDisagreement)).toEqual([])
  })
})

/**
 * The next site, found by asking where else a run is cut (#499).
 *
 * `startsARun` cuts a run in two places: an area a rule points at, and an area
 * given an ordering of its own, which is self-contained and takes no overflow.
 * `runFrom` has always read both. `nextRunStartAfter` and the band read only the
 * first, so a plank somebody had set to order by title headed a run for the
 * domain and headed nothing for the furniture — the same one-question-two-answers
 * this family is made of, reached by a different button, and the dialog on that
 * button says "would order itself, so nothing overflows into it" before anybody
 * presses it.
 */
describe('a plank that orders itself', () => {
  const secondPlankOrdersItself = async (): Promise<void> => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'area', 'c'))
    await db.run(
      'UPDATE area SET sort_strategy = \'title\' WHERE id = ?',
      [await plankOf(1, 2)],
    )
  }

  it('ends the run above it, exactly as a rule on it would', async () => {
    await secondPlankOrdersItself()

    expect(drawn(await runAreasOf(db, 'fiction'))).toEqual(['1:0@', '1:1@b'])
  })

  it('is not somebody else\'s to retire', async () => {
    await secondPlankOrdersItself()
    await repository.add(asked('fiction', 'area', 'bb'))

    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 1, position: 2, starts_at: 'c' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('agrees with the rules about the book above it', async () => {
    await secondPlankOrdersItself()
    await shelve('Wolf Hall', 'fiction', 'bb')

    expect((await areaDisagreements(db)).map(describeAreaDisagreement)).toEqual([])
  })
})
