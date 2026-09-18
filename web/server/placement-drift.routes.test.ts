/**
 * What `GET /api/placement/drift` answers, over real HTTP.
 *
 * `areaDisagreements` itself is covered by `placement-cutover.test.ts`,
 * `placement-backfill.test.ts`, `separator-repository.test.ts` and
 * `shelves.test.ts`. What is new here is that anything other than the server
 * log asks it:
 *
 * 1. A catalogue that agrees answers nothing rather than something soothing:
 *    an empty list is what both screens draw no card from.
 * 2. A disagreement comes back with both places on it, since one without the
 *    other is not something anybody can act on.
 * 3. Asking must never repair: a reader that quietly put a book right would
 *    hide a broken shelf indefinitely. There is no route that writes here,
 *    and this proves the one that reads does not either.
 *
 * The harness is `furniture.routes.test.ts`'s, cut to what this needs: a
 * catalogue with books actually shelved, since on an empty one every answer
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
 * `books.shelf_range` is written by a save and by nothing else, so a book
 * whose tag is removed afterwards keeps the range it already had: the shelf
 * still draws it in the fiction run, and no rule claims it any more. That is
 * a genuine disagreement between the two readings, and the cheapest honest
 * way to make one.
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

    // There is deliberately no cheerful field beside the empty list: a
    // reader that could print "the shelf agrees with the rules" is a reader
    // a bug can print it through over a check that never ran.
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
     * A check that repaired on sight would hide a broken shelf indefinitely.
     * The proof here is that the second answer is the first one, and the
     * book's own row is unchanged.
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
    // And no tag was written back to settle it either.
    expect(await db.all('SELECT * FROM book_tag WHERE book_id = ?', [second!])).toEqual([])
  })

  it('has no way to write to it', async () => {
    // Anything under /api that no route matched answers 404; pinned here so
    // a write route cannot be added back quietly.
    const posted = await fetch(`${baseUrl}/api/placement/drift`, { method: 'POST', headers: { cookie } })
    expect(posted.status).toBe(404)
  })
})
