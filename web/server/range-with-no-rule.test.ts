/**
 * A range no rule serves, which is #479.
 *
 * **The state is one press away and the app names it.** Taking the last rule
 * off the place that serves a range is a thing the rule editor offers and warns
 * about in its own words, "the library would have no rule saying where it
 * begins", and it is also where every collection starts: nothing has a rule
 * before somebody writes one. What every test below drives is that press.
 *
 * What it used to produce was two answers to one question. `Shelves.startOf`
 * said the range began at `{ shelf: 1, area: 0 }` and `Store.rangeStart` said
 * bookcase 4 for non-fiction, so the shelves screen drew non-fiction standing on
 * fiction's own entry plank while the placing screen offered `4A` to put the
 * book on. Neither literal had anything behind it: `4` is where the collection
 * this app grew out of happens to stand non-fiction.
 *
 * The owner settled that there is no per-genre default and there is not supposed
 * to be one, because the rule set is what says where a range begins. So the
 * answer is that there is no start, and these are the shapes that takes:
 * nothing to lay books along, no plank to name, no gap to point at, and a
 * sentence rather than a suggestion.
 *
 * Read `docs/shelving.md`, "A range no rule serves has no start at all".
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { Shelves } from './shelves'
import { Store } from './store'
import { applyRuleChange } from './place-rule'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { bandOf, runRuleOf } from '../infrastructure/shelving/areas'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
})

afterAll(closeTestDatabase)

const add = (author: string, genre = NON_FICTION_SLUG) =>
  store.addBook({ title: `${author}'s book`, authors: [author], genre })

/**
 * Take every rule off the place that serves a range, which is one press of
 * "have no rule here" on the rule editor.
 *
 * Through `applyRuleChange` rather than by deleting rows, because the point of
 * the issue is that this is an ordinary edit somebody makes rather than a state
 * reached by contrivance. The door is the one the screen presses.
 */
async function takeTheRuleOff(range: 'fiction' | 'nonfiction'): Promise<void> {
  const rule = await runRuleOf(db, range)
  if (!rule) throw new Error(`Nothing serves ${range}, so there is no rule to take off.`)

  const applied = await applyRuleChange(db, {
    about: rule.areaId === null ? 'fixture' : 'area',
    placeId: rule.areaId ?? rule.fixtureId!,
    rules: [],
  }, new Date().toISOString())

  if (!applied.ok) throw new Error(`The rule editor refused: ${applied.error}`)
}

/** The draft the placing screen is holding when somebody has just scanned a book. */
const drafting = (author: string, genre = NON_FICTION_SLUG) =>
  ({ title: `${author}'s book`, authors: [author], genre })

describe('a range no rule serves', () => {
  it('is reached by taking the last rule off the place that serves it', async () => {
    expect(await bandOf(db, 'nonfiction')).not.toBeNull()
    await takeTheRuleOff('nonfiction')
    expect(await bandOf(db, 'nonfiction')).toBeNull()

    // The other range is untouched, which is the half that must not move: this
    // is one range losing its rule, not the furniture going away.
    expect(await bandOf(db, 'fiction')).not.toBeNull()
  })

  it('has no start, rather than one of the two the app used to invent', async () => {
    await takeTheRuleOff('nonfiction')

    // The two disagreeing answers, asked the way the two screens ask them.
    // Before #479 these were `4A` and `1A`.
    expect(await shelves.beginsAt('nonfiction')).toBeNull()
    expect((await store.placementFor(drafting('Ackroyd'), 'nonfiction')).suggestedLocation)
      .toBe('')
  })

  it('says so on the placing screen instead of naming a plank', async () => {
    const placement = await store.placementFor(drafting('Ackroyd'), 'nonfiction')
    expect(placement.kind).toBe('first-in-range')

    await takeTheRuleOff('nonfiction')

    const after = await store.placementFor(drafting('Ackroyd'), 'nonfiction')
    expect(after.kind).toBe('range-has-no-start')
    expect(after.instruction).toBe(
      'Nothing says where non-fiction begins, so there is nowhere to put this book. '
      + 'Say what belongs on a bookcase or a shelf first.',
    )
    expect(after.suggestedLocation).toBe('')
  })

  it('keeps the two books either side, because the sequence is about the books', async () => {
    await add('Ackroyd')
    await add('Carson')
    await takeTheRuleOff('nonfiction')

    const between = await store.placementFor(drafting('Berger'), 'nonfiction')
    expect(between.kind).toBe('range-has-no-start')
    expect(between.predecessor?.title).toBe("Ackroyd's book")
    expect(between.successor?.title).toBe("Carson's book")
  })

  it('draws no run, and the books are all still catalogued', async () => {
    for (const author of ['Ackroyd', 'Berger', 'Carson']) await add(author)
    expect(await shelves.layout('nonfiction')).toHaveLength(3)

    await takeTheRuleOff('nonfiction')

    expect(await shelves.layout('nonfiction')).toEqual([])
    const drawn = await shelves.shelving('nonfiction')
    expect(drawn.groups).toEqual([])
    expect(drawn.begins).toBeNull()

    // The books, which is the half that must not move. A range with no rule has
    // nowhere to be drawn; it has not stopped holding anything.
    expect(await db.all('SELECT id FROM shelved_books WHERE shelf_range = ?', ['nonfiction']))
      .toHaveLength(3)
  })

  it('answers no plank for every sort key, rather than a plank on somebody else\'s run', async () => {
    const ids = []
    for (const author of ['Ackroyd', 'Berger']) ids.push((await add(author)).id)
    const keys = (await db.all<{ sort_key: string }>(
      'SELECT sort_key FROM shelved_books WHERE shelf_range = ? ORDER BY sort_key',
      ['nonfiction'],
    )).map((row) => row.sort_key)

    await takeTheRuleOff('nonfiction')

    // Both walks, and they agree. `areasForSortKeys` already answered null here
    // and `shelvesForSortKeys` used to answer `1A`, which is a real plank of a
    // real bookcase and is where fiction opens.
    expect(await shelves.shelvesForSortKeys('nonfiction', keys)).toEqual(['', ''])
    expect(await shelves.areasForSortKeys('nonfiction', keys)).toEqual([null, null])
    expect(ids).toHaveLength(2)
  })

  it('sets every book of the range aside rather than passing them as filed', async () => {
    for (const author of ['Ackroyd', 'Berger', 'Carson']) await add(author)
    // Put each one where the app says it goes, so these are books somebody has
    // confirmed onto a shelf. A book that was never placed is set aside for a
    // different reason and would prove nothing about this one.
    for (const placed of await shelves.layout('nonfiction')) {
      await store.setLocation(placed.book.id, placed.label)
    }

    await takeTheRuleOff('nonfiction')

    /*
     * `review` used to walk the layout, and the layout is empty here. Reading it
     * would have taken every book of the range off the one list that says a book
     * is not where it belongs, silently, on exactly the state that produces the
     * most of them. It reads the books instead and `areasForSortKeys` answers
     * null for each, which is what the review already calls unplaceable.
     */
    const review = await shelves.review('nonfiction')
    expect(review.misfiles).toEqual([])
    expect(review.excluded.map((one) => one.reason)).toEqual(
      ['unplaceable', 'unplaceable', 'unplaceable'],
    )
  })

  it('leaves the other range with a start, and one range losing its rule is not both', async () => {
    await add('Ackroyd', FICTION_SLUG)
    const opensAt = await shelves.beginsAt('fiction')
    expect(opensAt).toBe('1A')

    await takeTheRuleOff('nonfiction')

    expect(await shelves.beginsAt('fiction')).toBe(opensAt)
    expect(await shelves.layout('fiction')).toHaveLength(1)

    /*
     * Fiction's run does grow, and that is the model's own answer rather than
     * anything #479 does. Nothing begins a run on the piece non-fiction's rule
     * used to point at, so that piece takes what overflows from the one before
     * it, which is what the rule editor says out loud before the press: "this
     * area goes back to taking what overflows from the area before it". Where
     * fiction *begins* is untouched, which is the statement this issue is about.
     */
    expect((await shelves.shelving('fiction')).groups).toHaveLength(2)
  })

  it('files a newly saved book with no placement to act on, and writes the row', async () => {
    await takeTheRuleOff('nonfiction')

    /*
     * The write path, which is what raised this issue's priority: a disagreement
     * that only affects what is drawn is a display bug, and one that reaches a
     * write puts a book somewhere on the strength of an answer another part of
     * the app does not share. The book is still catalogued, because a book
     * somebody scanned is a book they own; what it does not come with is a plank
     * nobody said anything about.
     */
    const saved = await store.addBook(drafting('Ackroyd'))
    expect(saved.placement?.kind).toBe('range-has-no-start')
    expect(saved.placement?.suggestedLocation).toBe('')
    expect(await db.get('SELECT id FROM books WHERE id = ?', [saved.id])).toBeTruthy()
  })
})
