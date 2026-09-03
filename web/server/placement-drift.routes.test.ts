/**
 * What `GET /api/placement/drift` answers, over real HTTP (#489).
 *
 * **The check under it is not what is being tested here.**
 * `areaDisagreements` has been put through its cases since #213, by
 * `placement-cutover.test.ts`, `placement-backfill.test.ts`,
 * `separator-repository.test.ts` and `shelves.test.ts`, and none of that
 * changed. What is new is that anything other than the server log asks it, and
 * that is what these tests are about, in the same two halves
 * `backup.routes.test.ts` names for its own route:
 *
 * 1. **A catalogue that agrees answers nothing rather than something soothing.**
 *    An empty list is what both screens draw no card from, and it has to be
 *    reachable, because the ordinary day is every day.
 * 2. **A disagreement comes back with both places on it.** One without the
 *    other is not something anybody can act on: the whole content of the answer
 *    is which two places disagree.
 *
 * And one that is not about wiring at all and is the reason the issue was
 * written: **asking must never repair.** #485's broken shelf was diagnosable
 * three weeks after it began only because it was stable and survived every
 * restart, so a reader that quietly put a book right would have hidden the
 * defect indefinitely. There is no route that writes here and this proves the
 * one that reads does not either.
 *
 * The harness is `furniture.routes.test.ts`'s, cut to what this needs: a
 * catalogue with books actually shelved, because on an empty one every answer
 * on this route is the same answer.
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
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves
let app: BookScanApp
let server: Server
let baseUrl: string
/** The session every request in this file carries. See server/testauth.ts. */
let cookie: string
/** This file's own scratch root, which no other test file can name. */
let scratch: string
let coverDir: string

/** A save, all of the steps `POST /api/books` performs, so the tag is written. */
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

const draft = (at: number): DraftBook => ({
  title: `Title ${String(at).padStart(3, '0')}`,
  authors: [`Author ${String(at).padStart(3, '0')}`],
  genre: FICTION_SLUG,
})

/** Three books saved and shelved the way a person saves them. */
async function threeBooks(): Promise<number[]> {
  const ids: number[] = []
  for (let at = 0; at < 3; at += 1) ids.push(await shelve(draft(at)))
  return ids
}

/**
 * Take the genre tag off a book that is already shelved.
 *
 * **The state #223 describes, and it is reached without touching a placement.**
 * `books.shelf_range` is written by a save and by nothing else, so a book whose
 * tag is removed afterwards keeps the range it already had and stays exactly
 * where it stands: the shelf still draws it in the fiction run, and no rule
 * claims it any more. That is a genuine disagreement between the two readings
 * and it is the cheapest honest way to make one.
 */
async function untag(id: number): Promise<void> {
  await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
}

async function drift(): Promise<{ books: { bookId: number; title: string;
  fromLayout: string; fromRules: string }[]; total: number }> {
  const response = await fetch(`${baseUrl}/api/placement/drift`, { headers: { cookie } })
  expect(response.status).toBe(200)
  return response.json()
}

beforeAll(() => { scratch = scratchRoot('placement-drift') })

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)

  coverDir = mkdtempSync(join(scratch, 'drift-test-'))
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

describe('GET /api/placement/drift', () => {
  it('says nothing at all about a catalogue whose two answers agree', async () => {
    await threeBooks()

    // Nought and an empty list, which is what both screens draw no card from.
    // There is deliberately no cheerful field beside it: a reader that could
    // print "the shelf agrees with the rules" is a reader a bug can print it
    // through over a check that never ran.
    expect(await drift()).toEqual({ books: [], total: 0 })
  })

  it('names the book, and both of the places that disagree about it', async () => {
    const [, second] = await threeBooks()
    await untag(second!)

    const answer = await drift()
    expect(answer.total).toBe(1)
    expect(answer.books).toHaveLength(1)

    const [found] = answer.books
    expect(found!.bookId).toBe(second)
    expect(found!.title).toBe('Title 001')
    // Where the app draws it, which is where somebody would go and look.
    expect(found!.fromLayout).not.toBe('')
    // And nothing on the other side, because no rule claims it any more. Empty
    // rather than absent: the screens say "and no rule claims it" from this.
    expect(found!.fromRules).toBe('')
  })

  it('answers the same thing twice, having changed nothing in between', async () => {
    /*
     * The whole reason #489 insists this stays a reader.
     *
     * A check that repaired on sight would have hidden #485's defect
     * indefinitely: the broken shelf was found three weeks in precisely because
     * it was stable and outlived every restart. So asking is not an act, and
     * the proof is that the second answer is the first one and the book's own
     * row is where it was.
     */
    const [, second] = await threeBooks()
    await untag(second!)

    const before = await db.get<{ shelf_range: string; current_area_id: number | null }>(
      'SELECT shelf_range, current_area_id FROM books WHERE id = ?', [second!],
    )

    const first = await drift()
    const again = await drift()

    expect(again).toEqual(first)
    expect(await db.get(
      'SELECT shelf_range, current_area_id FROM books WHERE id = ?', [second!],
    )).toEqual(before)
    // And no tag was written back to settle it either, which is the repair
    // #304 stopped the app making on the owner's explicit instruction.
    expect(await db.all('SELECT * FROM book_tag WHERE book_id = ?', [second!])).toEqual([])
  })

  it('has no way to write to it', async () => {
    // Not a style point. A screen that looks unfinished without a button is how
    // a repair gets added later, so the absence is pinned here as well as said
    // on the card. Anything under /api that no route matched answers 404.
    const posted = await fetch(`${baseUrl}/api/placement/drift`, { method: 'POST', headers: { cookie } })
    expect(posted.status).toBe(404)
  })
})
